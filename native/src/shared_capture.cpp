/**
 * shared_capture.cpp
 * Captura de tela DXGI Desktop Duplication SEM readback para a CPU.
 *
 * Cada frame e copiado (GPU->GPU) para uma textura BGRA compartilhada (NT handle) de um anel de slots.
 * O JS recebe apenas o valor do HANDLE (8 bytes) + indice do slot; o processo principal do Electron o
 * entrega ao renderer via `electron.sharedTexture` (importSharedTexture/sendSharedTexture), onde vira um
 * VideoFrame com textura na GPU. O slot so volta a ser usado apos releaseSharedFrame(slot).
 *
 * Exporta: startSharedCapture(config, cb), releaseSharedFrame(slot), stopSharedCapture()
 */

#include <napi.h>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <memory>
#include <thread>
#include "shared_capture.h"

#ifdef PLATFORM_WINDOWS
  #include <windows.h>
  #include <d3d11.h>
  #include <dxgi1_2.h>
  #include <wrl/client.h>
  #include <timeapi.h>
  #pragma comment(lib, "winmm.lib")
  using Microsoft::WRL::ComPtr;

namespace {

constexpr int kSlots = 4;

struct Slot {
  ComPtr<ID3D11Texture2D> tex;
  HANDLE                  nt = nullptr;
  std::atomic<bool>       busy{false};
};

struct SharedCapture {
  ComPtr<ID3D11Device>           device;
  ComPtr<ID3D11DeviceContext>    ctx;
  ComPtr<IDXGIOutputDuplication> dup;
  ComPtr<ID3D11Query>            query;
  Slot                           slots[kSlots];
  UINT                           width = 0;
  UINT                           height = 0;
  std::thread                    thread;
  std::atomic<bool>              running{false};
  std::atomic<uint64_t>          sent{0};
  std::atomic<uint64_t>          dropped{0};
};

std::unique_ptr<SharedCapture> g_sc;

bool InitSharedCapture(int monitorIndex) {
  g_sc = std::make_unique<SharedCapture>();

  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;

  // Adapter que possui a saida pedida (a duplicacao exige o mesmo adapter do device).
  ComPtr<IDXGIAdapter1> adapter;
  ComPtr<IDXGIOutput>   output;
  int remaining = monitorIndex;
  for (UINT ai = 0; factory->EnumAdapters1(ai, &adapter) == S_OK; ++ai) {
    ComPtr<IDXGIOutput> o;
    for (UINT oi = 0; adapter->EnumOutputs(oi, &o) == S_OK; ++oi) {
      if (remaining == 0) { output = o; break; }
      --remaining;
    }
    if (output) break;
    adapter.Reset();
  }
  if (!output) return false;

  HRESULT hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
                                 D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
                                 &g_sc->device, nullptr, &g_sc->ctx);
  if (FAILED(hr)) return false;

  ComPtr<IDXGIOutput1> output1;
  if (FAILED(output.As(&output1))) return false;
  DXGI_OUTPUT_DESC od{};
  output->GetDesc(&od);
  g_sc->width  = od.DesktopCoordinates.right  - od.DesktopCoordinates.left;
  g_sc->height = od.DesktopCoordinates.bottom - od.DesktopCoordinates.top;

  // Saida rotacionada: a textura duplicada tem a orientacao do "desktop", nao a logica; usa o desc da duplicacao.
  hr = output1->DuplicateOutput(g_sc->device.Get(), &g_sc->dup);
  if (FAILED(hr)) return false;
  DXGI_OUTDUPL_DESC dd{};
  g_sc->dup->GetDesc(&dd);
  g_sc->width  = dd.ModeDesc.Width;
  g_sc->height = dd.ModeDesc.Height;

  D3D11_TEXTURE2D_DESC td{};
  td.Width = g_sc->width;
  td.Height = g_sc->height;
  td.MipLevels = 1;
  td.ArraySize = 1;
  td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  td.SampleDesc.Count = 1;
  td.Usage = D3D11_USAGE_DEFAULT;
  td.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
  td.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  for (auto& s : g_sc->slots) {
    if (FAILED(g_sc->device->CreateTexture2D(&td, nullptr, &s.tex))) return false;
    ComPtr<IDXGIResource1> res;
    if (FAILED(s.tex.As(&res))) return false;
    if (FAILED(res->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
                                       nullptr, &s.nt))) return false;
  }

  D3D11_QUERY_DESC qd{};
  qd.Query = D3D11_QUERY_EVENT;
  return SUCCEEDED(g_sc->device->CreateQuery(&qd, &g_sc->query));
}

void SharedLoop(Napi::ThreadSafeFunction tsfn, int targetFps) {
  using clock = std::chrono::steady_clock;
  const auto frameDur = std::chrono::microseconds(1000000 / targetFps);
  // Com monitor cujo refresh nao e multiplo do alvo (ex.: 99 Hz -> 60), aceita enviar um pouco antes do prazo;
  // sem isso cada prazo perdido por < 1 tick adiaria o envio em um tick inteiro (50 fps em vez de 60).
  const auto early = std::chrono::milliseconds(5);
  auto nextDeadline = clock::now();
  const auto t0 = clock::now();

  while (g_sc->running) {
    DXGI_OUTDUPL_FRAME_INFO fi{};
    ComPtr<IDXGIResource> res;
    HRESULT hr = g_sc->dup->AcquireNextFrame(100, &fi, &res);
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
    if (FAILED(hr)) break;  // ACCESS_LOST (troca de modo/UAC): o JS decide reiniciar

    const auto now = clock::now();
    const bool hasImage = fi.LastPresentTime.QuadPart != 0;
    if (!hasImage || now + early < nextDeadline) {
      g_sc->dup->ReleaseFrame();
      continue;
    }
    nextDeadline += frameDur;
    if (now > nextDeadline + 2 * frameDur) nextDeadline = now + frameDur;  // ressincroniza apos travada

    int idx = -1;
    for (int i = 0; i < kSlots; ++i) {
      bool expected = false;
      if (g_sc->slots[i].busy.compare_exchange_strong(expected, true)) { idx = i; break; }
    }
    if (idx < 0) {  // consumidor atrasado: descarta em vez de acumular latencia
      g_sc->dropped.fetch_add(1);
      g_sc->dup->ReleaseFrame();
      continue;
    }

    ComPtr<ID3D11Texture2D> src;
    res.As(&src);
    g_sc->ctx->CopyResource(g_sc->slots[idx].tex.Get(), src.Get());
    g_sc->ctx->End(g_sc->query.Get());
    g_sc->ctx->Flush();
    // Garante que a copia terminou antes de outro device (GPU process do Chromium) ler a textura.
    while (g_sc->ctx->GetData(g_sc->query.Get(), nullptr, 0, 0) == S_FALSE) std::this_thread::yield();
    g_sc->dup->ReleaseFrame();

    const uint64_t tsUs = std::chrono::duration_cast<std::chrono::microseconds>(clock::now() - t0).count();
    const uintptr_t hv = reinterpret_cast<uintptr_t>(g_sc->slots[idx].nt);
    const UINT w = g_sc->width, h = g_sc->height;
    g_sc->sent.fetch_add(1);

    auto st = tsfn.NonBlockingCall([idx, hv, w, h, tsUs](Napi::Env env, Napi::Function cb) {
      Napi::Object o = Napi::Object::New(env);
      o.Set("slot", Napi::Number::New(env, idx));
      o.Set("handle", Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<const uint8_t*>(&hv), sizeof(hv)));
      o.Set("width", Napi::Number::New(env, w));
      o.Set("height", Napi::Number::New(env, h));
      o.Set("timestampUs", Napi::Number::New(env, static_cast<double>(tsUs)));
      cb.Call({o});
    });
    if (st != napi_ok) g_sc->slots[idx].busy = false;
  }
  tsfn.Release();
}

}  // namespace
#endif  // PLATFORM_WINDOWS

Napi::Value StartSharedCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef PLATFORM_WINDOWS
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Uso: startSharedCapture(config, callback)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (g_sc && g_sc->running) {
    Napi::Error::New(env, "Captura compartilhada ja em andamento").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object cfg = info[0].As<Napi::Object>();
  int fps = cfg.Get("fps").IsNumber() ? cfg.Get("fps").As<Napi::Number>().Int32Value() : 60;
  int mon = cfg.Get("monitorIndex").IsNumber() ? cfg.Get("monitorIndex").As<Napi::Number>().Int32Value() : 0;
  fps = std::max(1, std::min(240, fps));

  if (!InitSharedCapture(mon)) {
    g_sc.reset();
    Napi::Error::New(env, "Falha ao inicializar a captura compartilhada (DXGI)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto tsfn = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "SharedCaptureCallback", 8, 1);
  timeBeginPeriod(1);  // sem isso o sleep/yield do Windows arredonda para 15,6 ms
  g_sc->running = true;
  g_sc->thread = std::thread(SharedLoop, std::move(tsfn), fps);
#else
  Napi::Error::New(env, "Captura compartilhada so existe no Windows").ThrowAsJavaScriptException();
#endif
  return env.Undefined();
}

Napi::Value ReleaseSharedFrame(const Napi::CallbackInfo& info) {
#ifdef PLATFORM_WINDOWS
  if (g_sc && info.Length() > 0 && info[0].IsNumber()) {
    int i = info[0].As<Napi::Number>().Int32Value();
    if (i >= 0 && i < kSlots) g_sc->slots[i].busy = false;
  }
#endif
  return info.Env().Undefined();
}

Napi::Value StopSharedCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef PLATFORM_WINDOWS
  if (!g_sc) return env.Undefined();
  g_sc->running = false;
  if (g_sc->thread.joinable()) g_sc->thread.join();
  timeEndPeriod(1);
  Napi::Object stats = Napi::Object::New(env);
  stats.Set("sent", Napi::Number::New(env, static_cast<double>(g_sc->sent.load())));
  stats.Set("dropped", Napi::Number::New(env, static_cast<double>(g_sc->dropped.load())));
  // Os HANDLEs ficam abertos ate aqui; o Chromium ja duplicou os que importou.
  for (auto& s : g_sc->slots) if (s.nt) { CloseHandle(s.nt); s.nt = nullptr; }
  g_sc.reset();
  return stats;
#else
  return env.Undefined();
#endif
}
