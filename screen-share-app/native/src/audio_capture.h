/**
 * audio_capture.h — Declarações das funções de captura de áudio
 */
#pragma once
#include <napi.h>

Napi::Value ListAudioSources(const Napi::CallbackInfo& info);
Napi::Value StartAudioCapture(const Napi::CallbackInfo& info);
Napi::Value StopAudioCapture(const Napi::CallbackInfo& info);
Napi::Value SetSourceVolume(const Napi::CallbackInfo& info);
