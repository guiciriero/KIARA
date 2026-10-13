/**
 * audio_capture.h — Declarações das funções de captura de áudio exportadas ao Node.js
 * O volume por aplicativo é controlado no renderer (GainNode), não no módulo nativo.
 */
#pragma once
#include <napi.h>

Napi::Value ListAudioSources(const Napi::CallbackInfo& info);
Napi::Value StartAudioCapture(const Napi::CallbackInfo& info);
Napi::Value StopAudioCapture(const Napi::CallbackInfo& info);
