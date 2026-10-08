// N-API adapter: the Node / Electron host for the OCC ops (occ_js.h).
#include <napi.h>

#include <cstring>

#include "occ_js.h"

namespace {

using occjs::Val;

napi_value Raw(Val v) {
  return static_cast<napi_value>(const_cast<void*>(v));
}

class NapiJs final : public occjs::Js {
 public:
  explicit NapiJs(const Napi::CallbackInfo& info)
      : info_(info), env_(info.Env()) {}

  size_t argc() override { return info_.Length(); }
  Val operator[](size_t i) override { return napi_value(info_[i]); }

  bool isNumber(Val v) override { return V(v).IsNumber(); }
  bool isBoolean(Val v) override { return V(v).IsBoolean(); }
  bool isString(Val v) override { return V(v).IsString(); }
  bool isArray(Val v) override { return V(v).IsArray(); }
  bool isNull(Val v) override { return V(v).IsNull(); }
  bool isUndefined(Val v) override { return V(v).IsUndefined(); }

  occjs::Typed typed(Val v) override {
    occjs::Typed t;
    if (!V(v).IsTypedArray()) return t;
    napi_typedarray_type type;
    size_t length;
    void* data;
    napi_value buffer;
    size_t offset;
    // `data` already points at the first element (byte offset applied).
    NAPI_THROW_IF_FAILED(env_,
                         napi_get_typedarray_info(env_, Raw(v), &type, &length,
                                                  &data, &buffer, &offset),
                         t);
    t.data = data;
    t.length = length;
    switch (type) {
      case napi_float32_array: t.kind = occjs::TypedKind::Float32; break;
      case napi_float64_array: t.kind = occjs::TypedKind::Float64; break;
      case napi_uint32_array: t.kind = occjs::TypedKind::Uint32; break;
      case napi_int32_array: t.kind = occjs::TypedKind::Int32; break;
      default: t.kind = occjs::TypedKind::Other; break;
    }
    return t;
  }

  double number(Val v) override {
    return V(v).As<Napi::Number>().DoubleValue();
  }
  bool boolean(Val v) override { return V(v).As<Napi::Boolean>().Value(); }
  std::string string(Val v) override {
    return V(v).As<Napi::String>().Utf8Value();
  }
  uint32_t length(Val v) override { return V(v).As<Napi::Array>().Length(); }
  Val at(Val v, uint32_t i) override {
    return napi_value(V(v).As<Napi::Array>().Get(i));
  }
  bool has(Val v, const char* key) override {
    return V(v).As<Napi::Object>().Has(key);
  }
  Val get(Val v, const char* key) override {
    return napi_value(V(v).As<Napi::Object>().Get(key));
  }

  Val makeNumber(double d) override {
    return napi_value(Napi::Number::New(env_, d));
  }
  Val makeString(const std::string& s) override {
    return napi_value(Napi::String::New(env_, s));
  }
  Val makeNull() override { return napi_value(env_.Null()); }
  Val makeUndefined() override { return napi_value(env_.Undefined()); }
  Val makeObject() override { return napi_value(Napi::Object::New(env_)); }
  Val makeArray(uint32_t n) override {
    return napi_value(Napi::Array::New(env_, n));
  }
  void set(Val o, const char* key, Val v) override {
    V(o).As<Napi::Object>().Set(key, V(v));
  }
  using Js::set;
  void setAt(Val a, uint32_t i, Val v) override {
    V(a).As<Napi::Object>().Set(i, V(v));
  }
  Val makeFloat32Array(const float* d, size_t n) override {
    auto a = Napi::Float32Array::New(env_, n);
    if (n) std::memcpy(a.Data(), d, n * sizeof(float));
    return napi_value(a);
  }
  Val makeFloat64Array(const double* d, size_t n) override {
    auto a = Napi::Float64Array::New(env_, n);
    if (n) std::memcpy(a.Data(), d, n * sizeof(double));
    return napi_value(a);
  }
  Val makeUint32Array(const uint32_t* d, size_t n) override {
    auto a = Napi::Uint32Array::New(env_, n);
    if (n) std::memcpy(a.Data(), d, n * sizeof(uint32_t));
    return napi_value(a);
  }

 private:
  Napi::Value V(Val v) { return Napi::Value(env_, Raw(v)); }

  const Napi::CallbackInfo& info_;
  Napi::Env env_;
};

Napi::Value Dispatch(const Napi::CallbackInfo& info) {
  const auto* op = static_cast<const occjs::Op*>(info.Data());
  NapiJs js(info);
  try {
    return Napi::Value(info.Env(), Raw(op->fn(js)));
  } catch (const std::exception& e) {
    // OCC's Standard_Failure is a std::exception too.
    throw Napi::Error::New(info.Env(), e.what());
  }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  occjs::Init();
  for (const occjs::Op& op : occjs::Ops())
    exports.Set(op.name,
                Napi::Function::New(env, Dispatch, op.name,
                                    const_cast<occjs::Op*>(&op)));
  return exports;
}

}  // namespace

NODE_API_MODULE(occ_addon, Init)
