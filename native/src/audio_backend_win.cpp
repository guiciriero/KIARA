/**
 * audio_backend_win.cpp
 * Backend Windows da captura de áudio por aplicativo (WASAPI Process Loopback).
 *
 * Contrato: audio_backend.h
 *   - ListSources() : sessões de áudio do endpoint de renderização padrão
 *   - Start()       : uma captura independente (thread própria) por PID
 *   - Stop()        : sinaliza parada e aguarda todas as threads
 *
 * Requisitos: Windows 10 versão 2004 (build 19041) ou superior para o
 * Process Loopback (ActivateAudioInterfaceAsync com
 * VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK). SDK 10.0.19041+ para compilar
 * (audioclientactivationparams.h).
 *
 * Formato entregue: float32 intercalado, 48000 Hz, 2 canais.
 */

#ifdef PLATFORM_WINDOWS

// A ordem dos includes importa: windows.h primeiro, depois cabeçalhos multimídia/COM.
#include <windows.h>
#include <mmsystem.h>
#include <mmreg.h>
#include <objbase.h>
#include <objidl.h>
#include <propidl.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <audioclientactivationparams.h>
#include <wrl/client.h>

#include <atomic>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "audio_backend.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "user32.lib")

using Microsoft::WRL::ComPtr;

namespace audio_backend {

namespace {

// ── Constantes ────────────────────────────────────────────────────────────────

constexpr WORD     kChannels            = 2;
constexpr DWORD    kSampleRate          = 48000;
constexpr WORD     kBitsPerSample       = 32;
constexpr DWORD    kBuildProcessLoopback = 19041;          // Windows 10 2004
constexpr DWORD    kActivationTimeoutMs = 5000;            // Espera máxima pela ativação
constexpr DWORD    kWaitTimeoutMs       = 100;             // Intervalo para checar a flag de parada
constexpr REFERENCE_TIME kBufferDuration100ns = 200000;    // 20 ms
constexpr UINT32   kMaxFramesPerPacket  = kSampleRate * 10; // Limite de segurança (10 s)

// ── Utilidades ────────────────────────────────────────────────────────────────

/** Formata um HRESULT como "0xXXXXXXXX". */
std::string HrToString(HRESULT hr) {
  char buf[16];
  snprintf(buf, sizeof(buf), "0x%08X", (unsigned int)hr);
  return buf;
}

/** UTF-16 → UTF-8 (sem APIs ANSI). */
std::string WideToUtf8(const wchar_t* ws, int len) {
  if (!ws || len <= 0) return std::string();
  int n = WideCharToMultiByte(CP_UTF8, 0, ws, len, nullptr, 0, nullptr, nullptr);
  if (n <= 0) return std::string();
  std::string out((size_t)n, '\0');
  if (WideCharToMultiByte(CP_UTF8, 0, ws, len, &out[0], n, nullptr, nullptr) <= 0)
    return std::string();
  return out;
}

/** Handle Win32 com fechamento automático. */
class UniqueHandle {
 public:
  UniqueHandle() = default;
  explicit UniqueHandle(HANDLE h) : h_(h) {}
  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;
  ~UniqueHandle() { Reset(); }
  void Reset(HANDLE h = nullptr) {
    if (h_ && h_ != INVALID_HANDLE_VALUE) CloseHandle(h_);
    h_ = h;
  }
  HANDLE Get() const { return h_; }
  bool Valid() const { return h_ != nullptr && h_ != INVALID_HANDLE_VALUE; }
 private:
  HANDLE h_ = nullptr;
};

/**
 * Inicialização COM por thread (RAII).
 * Se a thread já estiver inicializada com outro modelo (RPC_E_CHANGED_MODE),
 * seguimos em frente sem chamar CoUninitialize.
 */
class ComScope {
 public:
  ComScope() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ok_ = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
    needUninit_ = SUCCEEDED(hr);   // S_OK ou S_FALSE exigem CoUninitialize
  }
  ComScope(const ComScope&) = delete;
  ComScope& operator=(const ComScope&) = delete;
  ~ComScope() { if (needUninit_) CoUninitialize(); }
  bool Ok() const { return ok_; }
 private:
  bool ok_ = false;
  bool needUninit_ = false;
};

/** Windows 10 build 19041+ (Process Loopback). Em caso de dúvida, assume suportado. */
bool IsProcessLoopbackSupported() {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return true;
  using RtlGetVersionFn = LONG (WINAPI*)(PRTL_OSVERSIONINFOW);
  auto fn = reinterpret_cast<RtlGetVersionFn>(
      reinterpret_cast<void*>(GetProcAddress(ntdll, "RtlGetVersion")));
  if (!fn) return true;
  RTL_OSVERSIONINFOW vi = {};
  vi.dwOSVersionInfoSize = sizeof(vi);
  if (fn(&vi) != 0) return true;
  if (vi.dwMajorVersion > 10) return true;
  return vi.dwMajorVersion == 10 && vi.dwBuildNumber >= kBuildProcessLoopback;
}

/** Resultado da checagem de existência de um processo. */
bool ProcessExists(uint32_t pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (h) {
    CloseHandle(h);
    return true;
  }
  // Acesso negado significa que o processo existe, apenas não podemos abri-lo.
  return GetLastError() == ERROR_ACCESS_DENIED;
}

/** Nome do executável (apenas o arquivo, em UTF-8). Vazio em caso de falha. */
std::string GetExeName(uint32_t pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return std::string();
  UniqueHandle proc(h);

  std::vector<wchar_t> buf(32768);
  DWORD size = (DWORD)buf.size();
  if (!QueryFullProcessImageNameW(proc.Get(), 0, buf.data(), &size) || size == 0)
    return std::string();

  std::wstring full(buf.data(), size);
  size_t slash = full.find_last_of(L"\\/");
  std::wstring name = (slash == std::wstring::npos) ? full : full.substr(slash + 1);
  return WideToUtf8(name.c_str(), (int)name.size());
}

/** Remove a extensão ".exe" (sem diferenciar maiúsculas). */
std::string StripExe(const std::string& name) {
  if (name.size() > 4) {
    std::string tail = name.substr(name.size() - 4);
    for (char& c : tail) c = (char)tolower((unsigned char)c);
    if (tail == ".exe") return name.substr(0, name.size() - 4);
  }
  return name;
}

/** EnumWindows: guarda o título da primeira janela principal visível de cada PID. */
BOOL CALLBACK EnumWindowsTitleProc(HWND hwnd, LPARAM lParam) {
  try {
    auto* titles = reinterpret_cast<std::map<uint32_t, std::string>*>(lParam);
    if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;

    int len = GetWindowTextLengthW(hwnd);
    if (len <= 0) return TRUE;

    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0 || titles->count(pid)) return TRUE;

    std::vector<wchar_t> buf((size_t)len + 1);
    int got = GetWindowTextW(hwnd, buf.data(), len + 1);
    if (got <= 0) return TRUE;

    std::string title = WideToUtf8(buf.data(), got);
    if (!title.empty()) titles->emplace(pid, std::move(title));
  } catch (...) {
    // Nunca deixar exceção atravessar o callback do Windows
  }
  return TRUE;
}

// ── Completion handler da ativação assíncrona ────────────────────────────────

/**
 * Handler de ActivateAudioInterfaceAsync. Precisa ser agile (IAgileObject) pois
 * é invocado em uma thread do pool. O ciclo de vida é por contagem de referências:
 * o sistema pode manter o handler vivo mesmo após o timeout da espera, por isso
 * o evento pertence ao próprio handler.
 */
class ActivateHandler : public IActivateAudioInterfaceCompletionHandler,
                        public IAgileObject {
 public:
  ActivateHandler() { event_.Reset(CreateEventW(nullptr, TRUE, FALSE, nullptr)); }
  ActivateHandler(const ActivateHandler&) = delete;
  ActivateHandler& operator=(const ActivateHandler&) = delete;

  bool Valid() const { return event_.Valid(); }

  // IUnknown
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, __uuidof(IUnknown)) ||
        IsEqualIID(riid, __uuidof(IActivateAudioInterfaceCompletionHandler))) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (IsEqualIID(riid, __uuidof(IAgileObject))) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)++refs_; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG r = (ULONG)--refs_;
    if (r == 0) delete this;
    return r;
  }

  // IActivateAudioInterfaceCompletionHandler
  HRESULT STDMETHODCALLTYPE ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT hrActivate = E_FAIL;
    ComPtr<IUnknown> iface;
    HRESULT hr = operation ? operation->GetActivateResult(&hrActivate, &iface)
                           : E_POINTER;
    result_ = FAILED(hr) ? hr : hrActivate;
    if (SUCCEEDED(result_)) iface_ = iface;
    SetEvent(event_.Get());   // Publica result_/iface_ (escritos antes do SetEvent)
    return S_OK;
  }

  /** Espera a conclusão. Retorna false em timeout. */
  bool Wait(DWORD timeoutMs) { return WaitForSingleObject(event_.Get(), timeoutMs) == WAIT_OBJECT_0; }
  HRESULT Result() const { return result_; }
  ComPtr<IUnknown> TakeInterface() { return iface_; }

 private:
  ~ActivateHandler() = default;   // Só destruível via Release()

  std::atomic<long> refs_{1};
  UniqueHandle      event_;
  HRESULT           result_ = E_FAIL;
  ComPtr<IUnknown>  iface_;
};

/** Ativa um IAudioClient de Process Loopback para o PID. Retorna erro (pt-BR) ou vazio. */
std::string ActivateProcessLoopbackClient(uint32_t pid, ComPtr<IAudioClient>& out) {
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);   // Pilha: não usar PropVariantClear

  // Ponteiro cru com Release explícito: ComPtr não combina bem com classe de
  // herança múltipla de interfaces COM (base IUnknown ambígua).
  ActivateHandler* handler = new (std::nothrow) ActivateHandler();
  if (!handler) return "Memória insuficiente para iniciar a captura de áudio.";
  struct HandlerRelease {
    ActivateHandler* h;
    ~HandlerRelease() { h->Release(); }
  } handlerGuard{handler};

  if (!handler->Valid()) return "Falha ao criar evento de sincronização da ativação de áudio.";

  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv,
      static_cast<IActivateAudioInterfaceCompletionHandler*>(handler), &op);
  if (FAILED(hr))
    return "Falha ao solicitar a ativação da captura de áudio (código " + HrToString(hr) + ").";

  if (!handler->Wait(kActivationTimeoutMs))
    return "Tempo esgotado ao ativar a captura de áudio do processo.";

  hr = handler->Result();
  if (FAILED(hr))
    return "Falha na ativação da captura de áudio do processo (código " + HrToString(hr) +
           "). Verifique se o processo ainda existe e se o Windows é 10 versão 2004 ou superior.";

  ComPtr<IUnknown> unk = handler->TakeInterface();
  if (!unk) return "A ativação da captura de áudio não retornou uma interface válida.";
  hr = unk.As(&out);
  if (FAILED(hr))
    return "Interface de áudio inválida retornada pela ativação (código " + HrToString(hr) + ").";
  return std::string();
}

// ── Captura por PID ──────────────────────────────────────────────────────────

/** Lê todos os pacotes disponíveis e entrega ao callback. false = erro irrecuperável. */
bool DrainPackets(IAudioCaptureClient* cap, uint32_t pid, const ChunkCallback& cb,
                  const std::atomic<bool>& stop, std::vector<float>& zeros) {
  for (;;) {
    if (stop.load()) return true;

    UINT32 next = 0;
    HRESULT hr = cap->GetNextPacketSize(&next);
    if (FAILED(hr)) return false;
    if (next == 0) return true;

    BYTE*  data = nullptr;
    UINT32 frames = 0;
    DWORD  flags = 0;
    hr = cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
    if (hr == AUDCLNT_S_BUFFER_EMPTY) return true;
    if (FAILED(hr)) return false;

    if (frames > 0 && frames <= kMaxFramesPerPacket && !stop.load()) {
      const float* samples = nullptr;
      if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) || !data) {
        // Mantém a linha do tempo contínua enviando silêncio explícito
        zeros.assign((size_t)frames * kChannels, 0.0f);
        samples = zeros.data();
      } else {
        samples = reinterpret_cast<const float*>(data);
      }
      try {
        cb(pid, samples, frames);
      } catch (...) {
        // Exceção do callback não pode derrubar a thread
      }
    }

    cap->ReleaseBuffer(frames);
  }
}

/**
 * Corpo da captura: ativa, inicializa, sinaliza "pronto" via promise e roda o loop.
 * Todos os objetos COM vivem apenas dentro desta função (liberados antes do CoUninitialize).
 */
void RunCapture(uint32_t pid, const ChunkCallback& cb, const std::atomic<bool>& stop,
                std::promise<std::string>& ready, bool& readySent) {
  auto fail = [&](const std::string& msg) {
    readySent = true;
    ready.set_value("Processo " + std::to_string(pid) + ": " + msg);
  };

  ComPtr<IAudioClient> client;
  std::string err = ActivateProcessLoopbackClient(pid, client);
  if (!err.empty()) { fail(err); return; }

  // Process loopback não suporta GetMixFormat: formato definido explicitamente
  WAVEFORMATEX fmt = {};
  fmt.wFormatTag      = WAVE_FORMAT_IEEE_FLOAT;
  fmt.nChannels       = kChannels;
  fmt.nSamplesPerSec  = kSampleRate;
  fmt.wBitsPerSample  = kBitsPerSample;
  fmt.nBlockAlign     = (WORD)(kChannels * kBitsPerSample / 8);
  fmt.nAvgBytesPerSec = kSampleRate * fmt.nBlockAlign;
  fmt.cbSize          = 0;

  HRESULT hr = client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      kBufferDuration100ns, 0, &fmt, nullptr);
  if (FAILED(hr)) { fail("falha ao inicializar o cliente de áudio (código " + HrToString(hr) + ")."); return; }

  UniqueHandle event(CreateEventW(nullptr, FALSE, FALSE, nullptr));
  if (!event.Valid()) { fail("falha ao criar o evento de captura."); return; }

  hr = client->SetEventHandle(event.Get());
  if (FAILED(hr)) { fail("falha ao registrar o evento de captura (código " + HrToString(hr) + ")."); return; }

  ComPtr<IAudioCaptureClient> capture;
  hr = client->GetService(__uuidof(IAudioCaptureClient),
                          reinterpret_cast<void**>(capture.GetAddressOf()));
  if (FAILED(hr)) { fail("falha ao obter o cliente de captura (código " + HrToString(hr) + ")."); return; }

  hr = client->Start();
  if (FAILED(hr)) { fail("falha ao iniciar a captura (código " + HrToString(hr) + ")."); return; }

  // Tudo pronto: libera o Start() que está aguardando
  readySent = true;
  ready.set_value(std::string());

  std::vector<float> zeros;
  while (!stop.load()) {
    DWORD w = WaitForSingleObject(event.Get(), kWaitTimeoutMs);
    if (stop.load()) break;
    if (w == WAIT_TIMEOUT) continue;
    if (w != WAIT_OBJECT_0) break;
    if (!DrainPackets(capture.Get(), pid, cb, stop, zeros)) break;   // ex.: dispositivo invalidado
  }

  client->Stop();
}

/** Entrada da thread de captura. Nunca lança exceção. */
void CaptureThreadMain(uint32_t pid, ChunkCallback cb, std::shared_ptr<std::atomic<bool>> stop,
                       std::promise<std::string> ready) {
  bool readySent = false;
  try {
    ComScope com;   // Declarado antes do RunCapture: é destruído depois dos ComPtr dele
    if (!com.Ok()) {
      readySent = true;
      ready.set_value("Processo " + std::to_string(pid) + ": falha ao inicializar o COM.");
      return;
    }
    RunCapture(pid, cb, *stop, ready, readySent);
  } catch (...) {
    if (!readySent) {
      try {
        ready.set_value("Processo " + std::to_string(pid) + ": erro interno ao iniciar a captura.");
      } catch (...) {}
    }
  }
}

// ── Estado do backend (protegido por g_mutex) ────────────────────────────────

struct Worker {
  uint32_t    pid;
  std::thread thread;
};

std::mutex                          g_mutex;
std::vector<Worker>                 g_workers;
std::shared_ptr<std::atomic<bool>>  g_stop;
bool                                g_running = false;

/** Sinaliza parada e faz join de todas as threads. Requer g_mutex travado. */
void StopLocked() {
  if (g_stop) g_stop->store(true);
  for (auto& w : g_workers) {
    if (w.thread.joinable()) w.thread.join();
  }
  g_workers.clear();
  g_stop.reset();
  g_running = false;
}

}  // namespace

// ── API pública ──────────────────────────────────────────────────────────────

std::vector<SourceInfo> ListSources() {
  std::vector<SourceInfo> result;
  try {
    ComScope com;
    if (!com.Ok()) return result;

    ComPtr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(&enumerator))))
      return result;

    ComPtr<IMMDevice> device;
    if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device)))
      return result;

    ComPtr<IAudioSessionManager2> manager;
    if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                                reinterpret_cast<void**>(manager.GetAddressOf()))))
      return result;

    ComPtr<IAudioSessionEnumerator> sessions;
    if (FAILED(manager->GetSessionEnumerator(&sessions))) return result;

    int count = 0;
    if (FAILED(sessions->GetCount(&count))) return result;

    // Títulos de janela (uma única varredura para todos os PIDs)
    std::map<uint32_t, std::string> titles;
    EnumWindows(EnumWindowsTitleProc, reinterpret_cast<LPARAM>(&titles));

    const DWORD selfPid = GetCurrentProcessId();
    std::set<uint32_t> seen;

    for (int i = 0; i < count; ++i) {
      ComPtr<IAudioSessionControl> ctrl;
      if (FAILED(sessions->GetSession(i, &ctrl))) continue;

      ComPtr<IAudioSessionControl2> ctrl2;
      if (FAILED(ctrl.As(&ctrl2))) continue;

      DWORD pid = 0;
      if (FAILED(ctrl2->GetProcessId(&pid))) continue;
      if (pid == 0 || pid == selfPid) continue;
      if (!seen.insert((uint32_t)pid).second) continue;   // Deduplica por PID

      std::string exe = GetExeName(pid);
      if (exe.empty()) continue;   // Processo inacessível/encerrado

      SourceInfo info;
      info.pid         = (uint32_t)pid;
      info.processName = exe;
      auto it = titles.find((uint32_t)pid);
      info.displayName = (it != titles.end() && !it->second.empty()) ? it->second : StripExe(exe);
      result.push_back(std::move(info));
    }
  } catch (...) {
    result.clear();
  }
  return result;
}

std::string Start(const std::vector<uint32_t>& pids, ChunkCallback callback) {
  std::lock_guard<std::mutex> lock(g_mutex);
  try {
    if (g_running) return "A captura de áudio já está em andamento.";
    if (!callback) return "Callback de áudio inválido.";
    if (pids.empty()) return "Nenhum processo informado para a captura de áudio.";

    if (!IsProcessLoopbackSupported())
      return "A captura de áudio por aplicativo exige Windows 10 versão 2004 (build 19041) ou superior.";

    // Deduplica PIDs preservando a ordem e valida a existência
    std::vector<uint32_t> unique;
    std::set<uint32_t> seen;
    for (uint32_t pid : pids) {
      if (pid == 0) return "PID inválido: 0.";
      if (!seen.insert(pid).second) continue;
      if (!ProcessExists(pid))
        return "O processo com PID " + std::to_string(pid) + " não existe mais.";
      unique.push_back(pid);
    }

    g_stop = std::make_shared<std::atomic<bool>>(false);

    // Dispara todas as threads e depois aguarda a confirmação de cada uma
    std::vector<std::future<std::string>> readies;
    for (uint32_t pid : unique) {
      std::promise<std::string> promise;
      readies.push_back(promise.get_future());
      Worker w;
      w.pid = pid;
      w.thread = std::thread(CaptureThreadMain, pid, callback, g_stop, std::move(promise));
      g_workers.push_back(std::move(w));
    }

    std::string firstError;
    for (auto& f : readies) {
      std::string e = f.get();
      if (!e.empty() && firstError.empty()) firstError = e;
    }

    if (!firstError.empty()) {
      StopLocked();   // Limpa o que já iniciou antes de reportar o erro
      return "Falha ao iniciar a captura de áudio. " + firstError;
    }

    g_running = true;
    return std::string();
  } catch (...) {
    StopLocked();
    return "Erro interno ao iniciar a captura de áudio.";
  }
}

void Stop() {
  std::lock_guard<std::mutex> lock(g_mutex);
  try {
    StopLocked();
  } catch (...) {
    // Idempotente e sem exceções para fora
  }
}

}  // namespace audio_backend

#endif  // PLATFORM_WINDOWS
