/**
 * audio_capture.cpp
 * Dispatcher N-API da captura de áudio por aplicativo.
 * A implementação por plataforma fica em audio_backend_*.{cpp,mm}
 * (contrato em audio_backend.h).
 *
 * Exporta para Node.js:
 *   - listAudioSources()                      → processos com áudio capturável
 *   - startAudioCapture({ pids }, callback)   → inicia a captura dos PIDs
 *   - stopAudioCapture()                      → para a captura
 *
 * callback recebe: { pid, pcm: Float32Array, frames, sampleRate: 48000, channels: 2 }
 * onde pcm é PCM float32 intercalado (L,R,L,R...).
 */

#include <napi.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include "audio_capture.h"
#include "audio_backend.h"

#if defined(PLATFORM_WINDOWS)
  static const char* kPlatformName = "windows";
#elif defined(PLATFORM_MACOS)
  static const char* kPlatformName = "macos";
#else
  static const char* kPlatformName = "linux";
#endif

namespace {
  bool                      g_active = false;
  Napi::ThreadSafeFunction  g_tsfn;
}

/** listAudioSources() → Array<AudioSource> */
Napi::Value ListAudioSources(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);

  uint32_t idx = 0;
  for (const auto& s : audio_backend::ListSources()) {
    char idBuf[32];
    snprintf(idBuf, sizeof(idBuf), "audio:%u", s.pid);

    Napi::Object src = Napi::Object::New(env);
    src.Set("id",          Napi::String::New(env, idBuf));
    src.Set("processId",   Napi::Number::New(env, (double)s.pid));
    src.Set("processName", Napi::String::New(env, s.processName));
    src.Set("displayName", Napi::String::New(env, s.displayName));
    src.Set("volume",      Napi::Number::New(env, 1.0));
    src.Set("isMuted",     Napi::Boolean::New(env, false));
    src.Set("platform",    Napi::String::New(env, kPlatformName));
    result.Set(idx++, src);
  }
  return result;
}

/** startAudioCapture({ pids: number[] }, callback) → void */
Napi::Value StartAudioCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Uso: startAudioCapture(config: object, callback: function)")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (g_active) {
    Napi::Error::New(env, "Captura de áudio já está em andamento").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Value pidsVal = info[0].As<Napi::Object>().Get("pids");
  if (!pidsVal.IsArray()) {
    Napi::TypeError::New(env, "config.pids deve ser um array de números").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Valida cada PID: inteiro positivo de 32 bits
  std::vector<uint32_t> pids;
  Napi::Array arr = pidsVal.As<Napi::Array>();
  for (uint32_t i = 0; i < arr.Length(); ++i) {
    Napi::Value v = arr.Get(i);
    if (!v.IsNumber()) {
      Napi::TypeError::New(env, "PID inválido").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    double d = v.As<Napi::Number>().DoubleValue();
    if (!(d >= 1.0 && d <= 4294967295.0) || d != std::floor(d)) {
      Napi::TypeError::New(env, "PID inválido").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    pids.push_back((uint32_t)d);
  }
  if (pids.empty()) {
    Napi::TypeError::New(env, "Informe ao menos um PID").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto tsfn = Napi::ThreadSafeFunction::New(
    env, info[1].As<Napi::Function>(), "AudioCaptureCallback", 0, 1);

  audio_backend::ChunkCallback cb =
    [tsfn](uint32_t pid, const float* data, uint32_t frames) mutable {
      auto pcm = std::make_shared<std::vector<float>>(data, data + (size_t)frames * 2);
      tsfn.NonBlockingCall([pcm, pid, frames](Napi::Env env, Napi::Function jsCb) {
        Napi::Float32Array arr = Napi::Float32Array::New(env, pcm->size());
        std::memcpy(arr.Data(), pcm->data(), pcm->size() * sizeof(float));

        Napi::Object chunk = Napi::Object::New(env);
        chunk.Set("pid",        Napi::Number::New(env, (double)pid));
        chunk.Set("pcm",        arr);
        chunk.Set("frames",     Napi::Number::New(env, (double)frames));
        chunk.Set("sampleRate", Napi::Number::New(env, 48000));
        chunk.Set("channels",   Napi::Number::New(env, 2));
        jsCb.Call({ chunk });
      });
    };

  std::string err = audio_backend::Start(pids, cb);
  if (!err.empty()) {
    audio_backend::Stop();
    tsfn.Release();
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_tsfn   = tsfn;
  g_active = true;
  return env.Undefined();
}

/** stopAudioCapture() → void */
Napi::Value StopAudioCapture(const Napi::CallbackInfo& info) {
  if (g_active) {
    audio_backend::Stop();   // Bloqueia até as threads do backend terminarem
    g_tsfn.Release();
    g_active = false;
  }
  return info.Env().Undefined();
}
