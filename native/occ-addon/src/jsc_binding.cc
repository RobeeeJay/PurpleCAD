// JavaScriptCore adapter: the iPad host for the OCC ops (occ_js.h).  Mirrors
// napi_binding.cc, including N-API's error text for a wrong argument type, so
// occ-bridge.cjs sees the same addon under either engine.
#include "jsc_binding.h"

#include <cstring>
#include <memory>

#include "occ_js.h"

namespace {

using occjs::Val;

JSValueRef Ref(Val v) { return static_cast<JSValueRef>(v); }

struct JsString {
  JSStringRef s;
  explicit JsString(const char* c) : s(JSStringCreateWithUTF8CString(c)) {}
  ~JsString() { JSStringRelease(s); }
};

std::string ToUtf8(JSStringRef s) {
  const size_t max = JSStringGetMaximumUTF8CStringSize(s);
  std::unique_ptr<char[]> buf(new char[max]);
  const size_t n = JSStringGetUTF8CString(s, buf.get(), max);
  return std::string(buf.get(), n ? n - 1 : 0);
}

class JscJs final : public occjs::Js {
 public:
  JscJs(JSContextRef ctx, size_t argc, const JSValueRef argv[])
      : ctx_(ctx), argc_(argc), argv_(argv) {}

  size_t argc() override { return argc_; }
  Val operator[](size_t i) override {
    return i < argc_ ? argv_[i] : JSValueMakeUndefined(ctx_);
  }

  bool isNumber(Val v) override { return JSValueIsNumber(ctx_, Ref(v)); }
  bool isBoolean(Val v) override { return JSValueIsBoolean(ctx_, Ref(v)); }
  bool isString(Val v) override { return JSValueIsString(ctx_, Ref(v)); }
  bool isArray(Val v) override { return JSValueIsArray(ctx_, Ref(v)); }
  bool isNull(Val v) override { return JSValueIsNull(ctx_, Ref(v)); }
  bool isUndefined(Val v) override { return JSValueIsUndefined(ctx_, Ref(v)); }

  occjs::Typed typed(Val v) override {
    occjs::Typed t;
    JSValueRef exc = nullptr;
    const JSTypedArrayType type = JSValueGetTypedArrayType(ctx_, Ref(v), &exc);
    Check(exc);
    if (type == kJSTypedArrayTypeNone || type == kJSTypedArrayTypeArrayBuffer)
      return t;
    JSObjectRef o = Object(v);
    // The bytes pointer is the BUFFER's start; a view over part of a buffer
    // (subarray) begins byteOffset further on.  Getting it pins the buffer,
    // so the pointer holds for the rest of the call.
    auto* base = static_cast<char*>(JSObjectGetTypedArrayBytesPtr(ctx_, o, &exc));
    Check(exc);
    const size_t offset = JSObjectGetTypedArrayByteOffset(ctx_, o, &exc);
    Check(exc);
    t.data = base + offset;
    t.length = JSObjectGetTypedArrayLength(ctx_, o, &exc);
    Check(exc);
    switch (type) {
      case kJSTypedArrayTypeFloat32Array: t.kind = occjs::TypedKind::Float32; break;
      case kJSTypedArrayTypeFloat64Array: t.kind = occjs::TypedKind::Float64; break;
      case kJSTypedArrayTypeUint32Array: t.kind = occjs::TypedKind::Uint32; break;
      case kJSTypedArrayTypeInt32Array: t.kind = occjs::TypedKind::Int32; break;
      default: t.kind = occjs::TypedKind::Other; break;
    }
    return t;
  }

  double number(Val v) override {
    if (!isNumber(v)) throw std::runtime_error("A number was expected");
    JSValueRef exc = nullptr;
    const double d = JSValueToNumber(ctx_, Ref(v), &exc);
    Check(exc);
    return d;
  }
  bool boolean(Val v) override {
    if (!isBoolean(v)) throw std::runtime_error("A boolean was expected");
    return JSValueToBoolean(ctx_, Ref(v));
  }
  std::string string(Val v) override {
    if (!isString(v)) throw std::runtime_error("A string was expected");
    JSValueRef exc = nullptr;
    JSStringRef s = JSValueToStringCopy(ctx_, Ref(v), &exc);
    Check(exc);
    std::string out = ToUtf8(s);
    JSStringRelease(s);
    return out;
  }
  uint32_t length(Val v) override {
    if (!isArray(v)) throw std::runtime_error("An array was expected");
    return static_cast<uint32_t>(number(get(v, "length")));
  }
  Val at(Val v, uint32_t i) override {
    JSValueRef exc = nullptr;
    JSValueRef r = JSObjectGetPropertyAtIndex(ctx_, Object(v), i, &exc);
    Check(exc);
    return r;
  }
  bool has(Val v, const char* key) override {
    JsString k(key);
    return JSObjectHasProperty(ctx_, Object(v), k.s);
  }
  Val get(Val v, const char* key) override {
    JsString k(key);
    JSValueRef exc = nullptr;
    JSValueRef r = JSObjectGetProperty(ctx_, Object(v), k.s, &exc);
    Check(exc);
    return r;
  }

  Val makeNumber(double d) override { return JSValueMakeNumber(ctx_, d); }
  Val makeString(const std::string& s) override {
    JsString str(s.c_str());
    return JSValueMakeString(ctx_, str.s);
  }
  Val makeNull() override { return JSValueMakeNull(ctx_); }
  Val makeUndefined() override { return JSValueMakeUndefined(ctx_); }
  Val makeObject() override { return JSObjectMake(ctx_, nullptr, nullptr); }
  Val makeArray(uint32_t n) override {
    JSValueRef exc = nullptr;
    JSObjectRef a = JSObjectMakeArray(ctx_, 0, nullptr, &exc);
    Check(exc);
    // Sized like N-API's Array::New(env, n): holes until each is set.
    if (n) set(a, "length", makeNumber(n));
    return a;
  }
  void set(Val o, const char* key, Val v) override {
    JsString k(key);
    JSValueRef exc = nullptr;
    JSObjectSetProperty(ctx_, Object(o), k.s, Ref(v), kJSPropertyAttributeNone,
                        &exc);
    Check(exc);
  }
  using Js::set;
  void setAt(Val a, uint32_t i, Val v) override {
    JSValueRef exc = nullptr;
    JSObjectSetPropertyAtIndex(ctx_, Object(a), i, Ref(v), &exc);
    Check(exc);
  }
  Val makeFloat32Array(const float* d, size_t n) override {
    return MakeTyped(kJSTypedArrayTypeFloat32Array, d, n, sizeof(float));
  }
  Val makeFloat64Array(const double* d, size_t n) override {
    return MakeTyped(kJSTypedArrayTypeFloat64Array, d, n, sizeof(double));
  }
  Val makeUint32Array(const uint32_t* d, size_t n) override {
    return MakeTyped(kJSTypedArrayTypeUint32Array, d, n, sizeof(uint32_t));
  }

 private:
  // A JavaScript exception raised inside an API call becomes a C++ one with
  // its message; the dispatcher turns it back into an Error for the caller.
  void Check(JSValueRef exc) {
    if (!exc) return;
    JSStringRef s = JSValueToStringCopy(ctx_, exc, nullptr);
    std::string msg = s ? ToUtf8(s) : "JavaScript exception";
    if (s) JSStringRelease(s);
    throw std::runtime_error(msg);
  }
  JSObjectRef Object(Val v) {
    if (isNull(v) || isUndefined(v))
      throw std::runtime_error("An object was expected");
    JSValueRef exc = nullptr;
    JSObjectRef o = JSValueToObject(ctx_, Ref(v), &exc);
    Check(exc);
    return o;
  }
  Val MakeTyped(JSTypedArrayType type, const void* d, size_t n, size_t size) {
    JSValueRef exc = nullptr;
    JSObjectRef a = JSObjectMakeTypedArray(ctx_, type, n, &exc);
    Check(exc);
    if (n) {
      void* p = JSObjectGetTypedArrayBytesPtr(ctx_, a, &exc);
      Check(exc);
      std::memcpy(p, d, n * size);
    }
    return a;
  }

  JSContextRef ctx_;
  size_t argc_;
  const JSValueRef* argv_;
};

JSValueRef Dispatch(JSContextRef ctx, JSObjectRef function, JSObjectRef,
                    size_t argc, const JSValueRef argv[],
                    JSValueRef* exception) {
  const auto* op = static_cast<const occjs::Op*>(JSObjectGetPrivate(function));
  JscJs js(ctx, argc, argv);
  try {
    return Ref(op->fn(js));
  } catch (const std::exception& e) {
    // OCC's Standard_Failure is a std::exception too.
    JsString msg(e.what());
    JSValueRef arg = JSValueMakeString(ctx, msg.s);
    *exception = JSObjectMakeError(ctx, 1, &arg, nullptr);
    return JSValueMakeUndefined(ctx);
  }
}

JSClassRef OpClass() {
  static JSClassRef cls = [] {
    JSClassDefinition def = kJSClassDefinitionEmpty;
    def.className = "OccFunction";
    def.callAsFunction = Dispatch;
    return JSClassCreate(&def);
  }();
  return cls;
}

}  // namespace

JSObjectRef OccMakeAddon(JSContextRef ctx) {
  occjs::Init();
  JSObjectRef addon = JSObjectMake(ctx, nullptr, nullptr);
  for (const occjs::Op& op : occjs::Ops()) {
    JSObjectRef fn =
        JSObjectMake(ctx, OpClass(), const_cast<occjs::Op*>(&op));
    JsString name(op.name);
    JSObjectSetProperty(ctx, addon, name.s, fn, kJSPropertyAttributeReadOnly,
                        nullptr);
  }
  return addon;
}
