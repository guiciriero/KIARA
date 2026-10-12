/**
 * addon_entry.cpp
 * Ponto de entrada do Node Addon.
 * Registra todas as funções exportadas para o runtime Node.js.
 */

#include <napi.h>
#include "screen_capture.h"
#include "audio_capture.h"

/**
 * Inicializa o módulo e registra as funções exportadas.
 * Chamado automaticamente pelo Node.js ao fazer require() do .node.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // ── Captura de Tela ────────────────────────────────────────────────────────
  exports.Set("listCaptureSources",
    Napi::Function::New(env, ListCaptureSources, "listCaptureSources"));

  exports.Set("startCapture",
    Napi::Function::New(env, StartCapture, "startCapture"));

  exports.Set("stopCapture",
    Napi::Function::New(env, StopCapture, "stopCapture"));

  // ── Captura de Áudio por Aplicativo ────────────────────────────────────────
  exports.Set("listAudioSources",
    Napi::Function::New(env, ListAudioSources, "listAudioSources"));

  exports.Set("startAudioCapture",
    Napi::Function::New(env, StartAudioCapture, "startAudioCapture"));

  exports.Set("stopAudioCapture",
    Napi::Function::New(env, StopAudioCapture, "stopAudioCapture"));

  return exports;
}

// Macro do NAPI que registra a função Init como inicializador do módulo
NODE_API_MODULE(screen_capture, Init)
