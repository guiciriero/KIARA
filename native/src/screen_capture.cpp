/**
 * screen_capture.cpp
 * Módulo de captura de tela usando DXGI Desktop Duplication API (Windows)
 * e X11 XGetImage (Linux).
 *
 * Exporta para Node.js:
 *   - listCaptureSources()  → array de janelas/monitores disponíveis
 *   - startCapture(config)  → inicia captura, retorna frames via callback
 *   - stopCapture()         → para a captura
 *
 * Arquitetura:
 *   Uma thread separada executa o loop de captura para não bloquear o event loop
 *   do Node.js. Os frames são passados ao JS via Napi::ThreadSafeFunction.
 */

#include <napi.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <chrono>
#include <memory>
#include "screen_capture.h"

#ifdef PLATFORM_WINDOWS
  #include <windows.h>
  #include <d3d11.h>
  #include <dxgi1_2.h>
  #include <wrl/client.h>
  using Microsoft::WRL::ComPtr;
#endif

#ifdef PLATFORM_LINUX
  #include <X11/Xlib.h>
  #include <X11/Xutil.h>
#endif

// ─── Estado global da captura ─────────────────────────────────────────────────
static std::atomic<bool> g_capturing{false};
static std::thread g_captureThread;

#ifdef PLATFORM_WINDOWS
// ─── Estruturas DXGI ──────────────────────────────────────────────────────────
struct DxgiCapture {
  ComPtr<ID3D11Device>           device;
  ComPtr<ID3D11DeviceContext>    context;
  ComPtr<IDXGIOutputDuplication> duplication;
  UINT                           width  = 0;
  UINT                           height = 0;
};
static std::unique_ptr<DxgiCapture> g_dxgi;

/**
 * Inicializa DXGI Desktop Duplication para o monitor especificado.
 * @param monitorIndex  Índice do monitor (0 = primário)
 * @return true se a inicialização foi bem-sucedida
 */
static bool InitDxgiCapture(int monitorIndex) {
  g_dxgi = std::make_unique<DxgiCapture>();

  // Cria dispositivo D3D11 com flags de depuração em debug builds
  D3D_FEATURE_LEVEL featureLevel;
  HRESULT hr = D3D11CreateDevice(
    nullptr,
    D3D_DRIVER_TYPE_HARDWARE,
    nullptr,
    0,
    nullptr, 0,
    D3D11_SDK_VERSION,
    &g_dxgi->device,
    &featureLevel,
    &g_dxgi->context
  );

  if (FAILED(hr)) return false;

  // Obtém factory DXGI
  ComPtr<IDXGIDevice>  dxgiDevice;
  ComPtr<IDXGIAdapter> adapter;
  ComPtr<IDXGIFactory1> factory;

  g_dxgi->device.As(&dxgiDevice);
  dxgiDevice->GetAdapter(&adapter);
  adapter->GetParent(IID_PPV_ARGS(&factory));

  // Enumera saídas (monitores) e seleciona pelo índice
  ComPtr<IDXGIOutput>  output;
  ComPtr<IDXGIOutput1> output1;
  hr = adapter->EnumOutputs(monitorIndex, &output);
  if (FAILED(hr)) return false;

  hr = output.As(&output1);
  if (FAILED(hr)) return false;

  // Obtém dimensões do monitor
  DXGI_OUTPUT_DESC desc;
  output->GetDesc(&desc);
  g_dxgi->width  = desc.DesktopCoordinates.right  - desc.DesktopCoordinates.left;
  g_dxgi->height = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;

  // Cria interface de duplicação de desktop
  hr = output1->DuplicateOutput(g_dxgi->device.Get(), &g_dxgi->duplication);
  return SUCCEEDED(hr);
}

/**
 * Loop de captura DXGI. Executa em thread separada.
 * Captura frames e envia ao callback JS via ThreadSafeFunction.
 */
static void DxgiCaptureLoop(
    Napi::ThreadSafeFunction tsfn,
    int targetFps
) {
  const auto frameDuration = std::chrono::milliseconds(1000 / targetFps);

  while (g_capturing) {
    auto frameStart = std::chrono::steady_clock::now();

    DXGI_OUTDUPL_FRAME_INFO frameInfo{};
    ComPtr<IDXGIResource> desktopResource;

    // Tenta adquirir o próximo frame (timeout de 16ms)
    HRESULT hr = g_dxgi->duplication->AcquireNextFrame(
      16, &frameInfo, &desktopResource
    );

    if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
      // Nenhum frame novo — aguarda o próximo ciclo
      std::this_thread::sleep_until(frameStart + frameDuration);
      continue;
    }

    if (FAILED(hr)) break; // Erro irrecuperável (ex.: monitor desconectado)

    // Obtém textura do frame
    ComPtr<ID3D11Texture2D> frameTex;
    desktopResource.As(&frameTex);

    // Cria textura de staging para leitura pela CPU
    D3D11_TEXTURE2D_DESC texDesc{};
    frameTex->GetDesc(&texDesc);
    texDesc.Usage          = D3D11_USAGE_STAGING;
    texDesc.BindFlags      = 0;
    texDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    texDesc.MiscFlags      = 0;

    ComPtr<ID3D11Texture2D> stagingTex;
    g_dxgi->device->CreateTexture2D(&texDesc, nullptr, &stagingTex);
    g_dxgi->context->CopyResource(stagingTex.Get(), frameTex.Get());

    // Mapeia a textura para ler os pixels (formato BGRA)
    D3D11_MAPPED_SUBRESOURCE mapped{};
    hr = g_dxgi->context->Map(stagingTex.Get(), 0, D3D11_MAP_READ, 0, &mapped);

    if (SUCCEEDED(hr)) {
      // Copia os dados de pixel para um buffer gerenciado
      size_t dataSize = (size_t)mapped.RowPitch * texDesc.Height;
      auto pixelData = std::make_shared<std::vector<uint8_t>>(dataSize);
      memcpy(pixelData->data(), mapped.pData, dataSize);

      uint32_t w = texDesc.Width;
      uint32_t h = texDesc.Height;
      uint32_t pitch = mapped.RowPitch;

      g_dxgi->context->Unmap(stagingTex.Get(), 0);

      // Envia frame ao JS de forma assíncrona (não bloqueia esta thread)
      tsfn.BlockingCall([pixelData, w, h, pitch](Napi::Env env, Napi::Function jsCallback) {
        auto buf = Napi::Buffer<uint8_t>::Copy(env, pixelData->data(), pixelData->size());
        Napi::Object frame = Napi::Object::New(env);
        frame.Set("data",   buf);
        frame.Set("width",  Napi::Number::New(env, w));
        frame.Set("height", Napi::Number::New(env, h));
        frame.Set("pitch",  Napi::Number::New(env, pitch));
        frame.Set("format", Napi::String::New(env, "bgra"));
        jsCallback.Call({ frame });
      });
    }

    g_dxgi->duplication->ReleaseFrame();

    // Controle de taxa de frames
    std::this_thread::sleep_until(frameStart + frameDuration);
  }

  tsfn.Release();
}
#endif // PLATFORM_WINDOWS

// ─── API exportada para Node.js ───────────────────────────────────────────────

/**
 * listCaptureSources() → Array<{ id, name, type, bounds }>
 * Lista janelas e monitores disponíveis para captura.
 */
Napi::Value ListCaptureSources(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;

#ifdef PLATFORM_WINDOWS
  // Enumera monitores via EnumDisplayMonitors
  struct MonitorCtx { Napi::Array* arr; uint32_t* idx; Napi::Env* env; };
  MonitorCtx ctx{ &result, &idx, &env };

  EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR hm, HDC, LPRECT, LPARAM lp) -> BOOL {
    auto* c = reinterpret_cast<MonitorCtx*>(lp);
    MONITORINFOEXA mi;
    mi.cbSize = sizeof(mi);
    GetMonitorInfoA(hm, &mi);

    Napi::Object src = Napi::Object::New(*c->env);
    src.Set("id",   Napi::String::New(*c->env, std::string("monitor:") + mi.szDevice));
    src.Set("name", Napi::String::New(*c->env, std::string("Monitor: ") + mi.szDevice));
    src.Set("type", Napi::String::New(*c->env, "monitor"));

    Napi::Object bounds = Napi::Object::New(*c->env);
    bounds.Set("x",      Napi::Number::New(*c->env, mi.rcMonitor.left));
    bounds.Set("y",      Napi::Number::New(*c->env, mi.rcMonitor.top));
    bounds.Set("width",  Napi::Number::New(*c->env, mi.rcMonitor.right  - mi.rcMonitor.left));
    bounds.Set("height", Napi::Number::New(*c->env, mi.rcMonitor.bottom - mi.rcMonitor.top));
    src.Set("bounds", bounds);

    c->arr->Set((*c->idx)++, src);
    return TRUE;
  }, reinterpret_cast<LPARAM>(&ctx));

  // Enumera janelas abertas
  struct WindowCtx { Napi::Array* arr; uint32_t* idx; Napi::Env* env; };
  WindowCtx wCtx{ &result, &idx, &env };

  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* c = reinterpret_cast<WindowCtx*>(lp);
    if (!IsWindowVisible(hwnd)) return TRUE;

    char title[256] = {};
    GetWindowTextA(hwnd, title, sizeof(title));
    if (strlen(title) == 0) return TRUE;

    RECT rect;
    GetWindowRect(hwnd, &rect);
    if (rect.right - rect.left < 50) return TRUE; // Ignora janelas minúsculas

    char idBuf[32];
    snprintf(idBuf, sizeof(idBuf), "window:%p", (void*)hwnd);

    Napi::Object src = Napi::Object::New(*c->env);
    src.Set("id",   Napi::String::New(*c->env, idBuf));
    src.Set("name", Napi::String::New(*c->env, title));
    src.Set("type", Napi::String::New(*c->env, "window"));

    Napi::Object bounds = Napi::Object::New(*c->env);
    bounds.Set("x",      Napi::Number::New(*c->env, rect.left));
    bounds.Set("y",      Napi::Number::New(*c->env, rect.top));
    bounds.Set("width",  Napi::Number::New(*c->env, rect.right  - rect.left));
    bounds.Set("height", Napi::Number::New(*c->env, rect.bottom - rect.top));
    src.Set("bounds", bounds);

    c->arr->Set((*c->idx)++, src);
    return TRUE;
  }, reinterpret_cast<LPARAM>(&wCtx));
#endif // PLATFORM_WINDOWS

#ifdef PLATFORM_LINUX
  Display* display = XOpenDisplay(nullptr);
  if (display) {
    Screen* screen = DefaultScreenOfDisplay(display);
    Napi::Object src = Napi::Object::New(env);
    src.Set("id",   Napi::String::New(env, "monitor:0"));
    src.Set("name", Napi::String::New(env, "Tela Principal"));
    src.Set("type", Napi::String::New(env, "monitor"));

    Napi::Object bounds = Napi::Object::New(env);
    bounds.Set("x",      Napi::Number::New(env, 0));
    bounds.Set("y",      Napi::Number::New(env, 0));
    bounds.Set("width",  Napi::Number::New(env, WidthOfScreen(screen)));
    bounds.Set("height", Napi::Number::New(env, HeightOfScreen(screen)));
    src.Set("bounds", bounds);
    result.Set(idx++, src);

    XCloseDisplay(display);
  }
#endif

  return result;
}

/**
 * startCapture({ sourceId, fps, width, height }, frameCallback)
 * Inicia a captura em thread separada. frameCallback(frame) é chamado a cada frame.
 */
Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Uso: startCapture(config: object, callback: function)")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (g_capturing) {
    Napi::Error::New(env, "Captura já está em andamento").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object config = info[0].As<Napi::Object>();
  int fps    = config.Get("fps").IsNumber()    ? config.Get("fps").As<Napi::Number>().Int32Value()    : 30;
  int monIdx = config.Get("monitorIndex").IsNumber() ? config.Get("monitorIndex").As<Napi::Number>().Int32Value() : 0;

  // Garante que o FPS está em um range razoável (1-120)
  fps = std::max(1, std::min(120, fps));

  Napi::Function callback = info[1].As<Napi::Function>();

  // Cria ThreadSafeFunction para comunicar da thread de captura ao loop do Node
  auto tsfn = Napi::ThreadSafeFunction::New(
    env,
    callback,
    "ScreenCaptureCallback",
    0,    // Sem fila limitada
    1     // Apenas 1 thread produtora
  );

#ifdef PLATFORM_WINDOWS
  if (!InitDxgiCapture(monIdx)) {
    tsfn.Release();
    Napi::Error::New(env, "Falha ao inicializar DXGI Desktop Duplication")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_capturing = true;
  g_captureThread = std::thread(DxgiCaptureLoop, std::move(tsfn), fps);
#endif

#ifdef PLATFORM_LINUX
  // No Linux, usamos getDisplayMedia via navegador; stub retorna imediatamente
  tsfn.Release();
  Napi::Error::New(env, "No Linux, use getDisplayMedia no navegador")
    .ThrowAsJavaScriptException();
  return env.Undefined();
#endif

  return env.Undefined();
}

/**
 * stopCapture() → void
 * Para a thread de captura e libera recursos.
 */
Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  g_capturing = false;

  if (g_captureThread.joinable()) {
    g_captureThread.join();
  }

#ifdef PLATFORM_WINDOWS
  g_dxgi.reset();
#endif

  return info.Env().Undefined();
}
