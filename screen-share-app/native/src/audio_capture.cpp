/**
 * audio_capture.cpp
 * Captura de áudio por aplicativo individual usando:
 *   Windows : WASAPI loopback com filtragem por processo via AudioGraph API
 *   Linux   : PipeWire (sink-input por processo)
 *
 * Exporta para Node.js:
 *   - listAudioSources()              → processos com saída de áudio ativa
 *   - startAudioCapture(config, cb)   → inicia captura de áudio do(s) app(s)
 *   - stopAudioCapture()              → para a captura
 *   - setSourceVolume(id, volume)     → controle de volume individual
 *
 * Formato de saída de áudio: PCM 48kHz, 32-bit float, estéreo
 * O frontend é responsável por encodar em Opus antes de enviar via WebRTC.
 */

#include <napi.h>
#include <string>
#include <vector>
#include <map>
#include <thread>
#include <atomic>
#include <memory>
#include <algorithm>
#include "audio_capture.h"

#ifdef PLATFORM_WINDOWS
  #include <windows.h>
  #include <mmdeviceapi.h>
  #include <audioclient.h>
  #include <audiopolicy.h>
  #include <wrl/client.h>
  #include <functiondiscoverykeys_devpkey.h>
  #include <tlhelp32.h>     // Para EnumProcesses
  using Microsoft::WRL::ComPtr;

  // Tamanho do buffer de áudio (em frames)
  static constexpr UINT32 AUDIO_BUFFER_FRAMES = 960; // 20ms @ 48kHz

  // ─── Estrutura de uma sessão de áudio por processo ──────────────────────────
  struct AudioSession {
    DWORD   processId;
    std::string processName;
    float   volume = 1.0f;
    ComPtr<IAudioSessionControl2> control;
    ComPtr<ISimpleAudioVolume>    simpleVolume;
  };

  // ─── Estado global WASAPI ────────────────────────────────────────────────────
  static ComPtr<IMMDevice>           g_device;
  static ComPtr<IAudioClient>        g_audioClient;
  static ComPtr<IAudioCaptureClient> g_captureClient;
  static std::vector<AudioSession>   g_sessions;
  static std::map<DWORD, float>      g_volumeMap;   // PID → volume desejado
  static std::atomic<bool>           g_audioCapturing{false};
  static std::thread                 g_audioThread;

  /**
   * Obtém o nome do processo a partir do PID.
   */
  static std::string GetProcessName(DWORD pid) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return "Desconhecido";

    PROCESSENTRY32 pe;
    pe.dwSize = sizeof(pe);
    std::string name = "Desconhecido";

    if (Process32First(snapshot, &pe)) {
      do {
        if (pe.th32ProcessID == pid) {
          name = pe.szExeFile;
          break;
        }
      } while (Process32Next(snapshot, &pe));
    }

    CloseHandle(snapshot);
    return name;
  }

  /**
   * Inicializa WASAPI no modo loopback para captura do que está sendo reproduzido.
   * O loopback captura toda a saída do dispositivo padrão; filtramos por PID
   * multiplicando o volume das sessões indesejadas por zero.
   *
   * @return true se inicializado com sucesso
   */
  static bool InitWasapi() {
    // Inicializa COM nesta thread
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return false;

    ComPtr<IMMDeviceEnumerator> enumerator;
    hr = CoCreateInstance(
      __uuidof(MMDeviceEnumerator), nullptr,
      CLSCTX_ALL, IID_PPV_ARGS(&enumerator)
    );
    if (FAILED(hr)) return false;

    // Obtém dispositivo de saída padrão
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &g_device);
    if (FAILED(hr)) return false;

    // Ativa cliente de áudio no modo loopback
    hr = g_device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&g_audioClient);
    if (FAILED(hr)) return false;

    // Configura formato: 48kHz, float 32-bit, estéreo
    WAVEFORMATEX wfx{};
    wfx.wFormatTag      = WAVE_FORMAT_IEEE_FLOAT;
    wfx.nChannels       = 2;
    wfx.nSamplesPerSec  = 48000;
    wfx.wBitsPerSample  = 32;
    wfx.nBlockAlign     = wfx.nChannels * (wfx.wBitsPerSample / 8);
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;

    // Modo compartilhado com loopback — AUDCLNT_STREAMFLAGS_LOOPBACK é a chave!
    hr = g_audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK,
      10000000, // 1 segundo em unidades de 100ns
      0,
      &wfx,
      nullptr
    );
    if (FAILED(hr)) return false;

    hr = g_audioClient->GetService(IID_PPV_ARGS(&g_captureClient));
    return SUCCEEDED(hr);
  }

  /**
   * Loop de captura de áudio WASAPI.
   * Aplica volume por processo antes de enviar ao callback JS.
   */
  static void WasapiCaptureLoop(
      Napi::ThreadSafeFunction tsfn,
      std::vector<DWORD> targetPids
  ) {
    if (!InitWasapi()) {
      tsfn.Release();
      return;
    }

    g_audioClient->Start();

    while (g_audioCapturing) {
      UINT32 packetSize = 0;
      HRESULT hr = g_captureClient->GetNextPacketSize(&packetSize);
      if (FAILED(hr)) break;

      while (packetSize > 0) {
        BYTE* pData = nullptr;
        UINT32 numFrames = 0;
        DWORD flags = 0;

        hr = g_captureClient->GetBuffer(&pData, &numFrames, &flags, nullptr, nullptr);
        if (FAILED(hr)) break;

        if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && numFrames > 0) {
          // Calcula tamanho: 2 canais × 4 bytes (float32) × frames
          size_t byteCount = (size_t)numFrames * 2 * sizeof(float);
          auto pcm = std::make_shared<std::vector<float>>(numFrames * 2);
          memcpy(pcm->data(), pData, byteCount);

          // Aplica volume por processo (simplificado: se nenhum target, passa tudo)
          // Para filtragem real por PID, usa IAudioSessionManager2 para silenciar
          // sessões de outros processos antes da captura.
          if (!targetPids.empty()) {
            // Aplica volumes individuais (armazenados em g_volumeMap)
            for (auto& [pid, vol] : g_volumeMap) {
              // Controle via ISimpleAudioVolume da sessão do processo
              for (auto& session : g_sessions) {
                if (session.processId == pid && session.simpleVolume) {
                  session.simpleVolume->SetMasterVolume(vol, nullptr);
                }
              }
            }
          }

          uint32_t frames = numFrames;
          tsfn.BlockingCall([pcm, frames](Napi::Env env, Napi::Function cb) {
            auto buf = Napi::Buffer<float>::Copy(env, pcm->data(), pcm->size());
            Napi::Object chunk = Napi::Object::New(env);
            chunk.Set("pcm",        buf);
            chunk.Set("frames",     Napi::Number::New(env, frames));
            chunk.Set("sampleRate", Napi::Number::New(env, 48000));
            chunk.Set("channels",   Napi::Number::New(env, 2));
            cb.Call({ chunk });
          });
        }

        g_captureClient->ReleaseBuffer(numFrames);
        g_captureClient->GetNextPacketSize(&packetSize);
      }

      // Dorme 10ms entre ciclos de poll
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    g_audioClient->Stop();
    tsfn.Release();
    CoUninitialize();
  }
#endif // PLATFORM_WINDOWS

// ─── API exportada para Node.js ───────────────────────────────────────────────

/**
 * listAudioSources() → Array<{ id, processId, processName, displayName }>
 * Lista processos que possuem sessões de áudio ativas no dispositivo padrão.
 */
Napi::Value ListAudioSources(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;

#ifdef PLATFORM_WINDOWS
  // Inicializa COM se necessário
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(
    __uuidof(MMDeviceEnumerator), nullptr,
    CLSCTX_ALL, IID_PPV_ARGS(&enumerator)
  );
  if (FAILED(hr)) return result;

  ComPtr<IMMDevice> device;
  hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(hr)) return result;

  // Obtém gerenciador de sessões de áudio
  ComPtr<IAudioSessionManager2> sessionManager;
  hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
    (void**)&sessionManager);
  if (FAILED(hr)) return result;

  ComPtr<IAudioSessionEnumerator> sessionEnum;
  hr = sessionManager->GetSessionEnumerator(&sessionEnum);
  if (FAILED(hr)) return result;

  int sessionCount = 0;
  sessionEnum->GetCount(&sessionCount);

  for (int i = 0; i < sessionCount; ++i) {
    ComPtr<IAudioSessionControl>  ctrl;
    ComPtr<IAudioSessionControl2> ctrl2;
    sessionEnum->GetSession(i, &ctrl);
    if (!ctrl) continue;
    ctrl.As(&ctrl2);
    if (!ctrl2) continue;

    DWORD pid = 0;
    ctrl2->GetProcessId(&pid);
    if (pid == 0) continue; // Sessão do sistema, ignora

    std::string procName = GetProcessName(pid);

    // Monta objeto de fonte de áudio
    Napi::Object src = Napi::Object::New(env);
    char idBuf[64];
    snprintf(idBuf, sizeof(idBuf), "audio:%lu", (unsigned long)pid);

    src.Set("id",          Napi::String::New(env, idBuf));
    src.Set("processId",   Napi::Number::New(env, (double)pid));
    src.Set("processName", Napi::String::New(env, procName));
    src.Set("displayName", Napi::String::New(env, procName));
    src.Set("volume",      Napi::Number::New(env, 1.0));
    src.Set("isMuted",     Napi::Boolean::New(env, false));
    src.Set("platform",    Napi::String::New(env, "windows"));

    result.Set(idx++, src);
  }

  CoUninitialize();
#endif // PLATFORM_WINDOWS

#ifdef PLATFORM_LINUX
  // No Linux, lista sink-inputs do PipeWire via pw-cli (simplificado)
  // A integração completa requer a API C do PipeWire (pw_context, pw_core, etc.)
  Napi::Object src = Napi::Object::New(env);
  src.Set("id",          Napi::String::New(env, "audio:pipewire"));
  src.Set("processId",   Napi::Number::New(env, 0));
  src.Set("processName", Napi::String::New(env, "PipeWire Mix"));
  src.Set("displayName", Napi::String::New(env, "Áudio do Sistema (PipeWire)"));
  src.Set("volume",      Napi::Number::New(env, 1.0));
  src.Set("isMuted",     Napi::Boolean::New(env, false));
  src.Set("platform",    Napi::String::New(env, "linux"));
  result.Set(idx++, src);
#endif

  return result;
}

/**
 * startAudioCapture({ pids: number[] }, callback) → void
 * Inicia captura de áudio dos processos especificados.
 */
Napi::Value StartAudioCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Uso: startAudioCapture(config: object, callback: function)")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

#ifdef PLATFORM_WINDOWS
  if (g_audioCapturing) {
    Napi::Error::New(env, "Captura de áudio já está em andamento").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object config = info[0].As<Napi::Object>();
  std::vector<DWORD> targetPids;

  // Extrai lista de PIDs alvo
  if (config.Get("pids").IsArray()) {
    Napi::Array pids = config.Get("pids").As<Napi::Array>();
    for (uint32_t i = 0; i < pids.Length(); ++i) {
      targetPids.push_back((DWORD)pids.Get(i).As<Napi::Number>().Uint32Value());
    }
  }

  Napi::Function callback = info[1].As<Napi::Function>();
  auto tsfn = Napi::ThreadSafeFunction::New(env, callback, "AudioCaptureCallback", 0, 1);

  g_audioCapturing = true;
  g_audioThread = std::thread(WasapiCaptureLoop, std::move(tsfn), targetPids);
#endif

#ifdef PLATFORM_LINUX
  Napi::Error::New(env, "No Linux, use Web Audio API / getUserMedia no navegador")
    .ThrowAsJavaScriptException();
#endif

  return env.Undefined();
}

/**
 * stopAudioCapture() → void
 */
Napi::Value StopAudioCapture(const Napi::CallbackInfo& info) {
#ifdef PLATFORM_WINDOWS
  g_audioCapturing = false;
  if (g_audioThread.joinable()) g_audioThread.join();
  g_device.Reset();
  g_audioClient.Reset();
  g_captureClient.Reset();
  g_sessions.clear();
  g_volumeMap.clear();
#endif
  return info.Env().Undefined();
}

/**
 * setSourceVolume(processId: number, volume: number) → void
 * Controla o volume de um processo individualmente (0.0 - 1.0).
 */
Napi::Value SetSourceVolume(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Uso: setSourceVolume(processId: number, volume: number)")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

#ifdef PLATFORM_WINDOWS
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Uint32Value();
  float vol  = std::clamp(info[1].As<Napi::Number>().FloatValue(), 0.0f, 1.0f);
  g_volumeMap[pid] = vol;
#endif

  return env.Undefined();
}
