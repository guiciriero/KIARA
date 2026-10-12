/**
 * screen_capture.h — Declarações das funções de captura de tela
 */
#pragma once
#include <napi.h>

Napi::Value ListCaptureSources(const Napi::CallbackInfo& info);
Napi::Value StartCapture(const Napi::CallbackInfo& info);
Napi::Value StopCapture(const Napi::CallbackInfo& info);
