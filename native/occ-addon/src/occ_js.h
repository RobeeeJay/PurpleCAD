// The JavaScript surface the OCC ops are written against.  Each engine that
// hosts the ops implements it once: N-API for Node and Electron
// (napi_binding.cc), JavaScriptCore for the iPad (jsc_binding.cc).  The op
// bodies -- argument defaults, result shapes, error text -- then exist once,
// so the two engines can't drift apart the way occOps.js and occ-bridge.cjs
// can.
#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace occjs {

// A borrowed engine value (napi_value / JSValueRef), valid for one call.
using Val = const void*;

// A typed array's storage, valid for the duration of the call.  The member
// names follow node-addon-api's so op bodies read as they did.
template <typename T>
struct View {
  T* ptr = nullptr;
  size_t n = 0;
  T* Data() const { return ptr; }
  size_t ElementLength() const { return n; }
  T& operator[](size_t i) const { return ptr[i]; }
};
using F64 = View<const double>;
using U32 = View<const uint32_t>;

enum class TypedKind { None, Float32, Float64, Uint32, Int32, Other };

struct Typed {
  TypedKind kind = TypedKind::None;
  void* data = nullptr;
  size_t length = 0;  // elements, not bytes
};

class Js {
 public:
  virtual ~Js() = default;

  // Arguments.  One past the end reads as undefined, as in N-API.
  virtual size_t argc() = 0;
  virtual Val operator[](size_t i) = 0;

  virtual bool isNumber(Val) = 0;
  virtual bool isBoolean(Val) = 0;
  virtual bool isString(Val) = 0;
  virtual bool isArray(Val) = 0;
  virtual bool isNull(Val) = 0;
  virtual bool isUndefined(Val) = 0;
  virtual Typed typed(Val) = 0;  // kind None when not a typed array

  // Conversions throw when the value has the wrong type.
  virtual double number(Val) = 0;
  virtual bool boolean(Val) = 0;
  virtual std::string string(Val) = 0;
  virtual uint32_t length(Val array) = 0;
  virtual Val at(Val array, uint32_t i) = 0;
  virtual bool has(Val object, const char* key) = 0;
  virtual Val get(Val object, const char* key) = 0;

  virtual Val makeNumber(double) = 0;
  virtual Val makeString(const std::string&) = 0;
  virtual Val makeNull() = 0;
  virtual Val makeUndefined() = 0;
  virtual Val makeObject() = 0;
  virtual Val makeArray(uint32_t length) = 0;
  virtual void set(Val object, const char* key, Val v) = 0;
  virtual void setAt(Val array, uint32_t i, Val v) = 0;
  virtual Val makeFloat32Array(const float* data, size_t n) = 0;
  virtual Val makeFloat64Array(const double* data, size_t n) = 0;
  virtual Val makeUint32Array(const uint32_t* data, size_t n) = 0;

  // A number, or the fallback when the value is anything else.
  double num(Val v, double fallback = 0.0) {
    return isNumber(v) ? number(v) : fallback;
  }
  // ToInt32, as N-API's Int32Value: shape ids and counts.
  int32_t int32(Val v) {
    const double d = number(v);
    if (!(d == d) || d > 9.2e18 || d < -9.2e18) return 0;
    return static_cast<int32_t>(static_cast<int64_t>(d));
  }
  bool isTypedArray(Val v) { return typed(v).kind != TypedKind::None; }
  F64 f64(Val v) {
    Typed t = typed(v);
    if (t.kind != TypedKind::Float64)
      throw std::runtime_error("a Float64Array was expected");
    return {static_cast<const double*>(t.data), t.length};
  }
  U32 u32(Val v) {
    Typed t = typed(v);
    if (t.kind != TypedKind::Uint32)
      throw std::runtime_error("a Uint32Array was expected");
    return {static_cast<const uint32_t*>(t.data), t.length};
  }
  // Set obj[key] = number / string (the common result fields).
  void set(Val object, const char* key, double v) {
    set(object, key, makeNumber(v));
  }
};

// An exported function.  It throws std::exception on failure; the adapter
// turns that into a JavaScript Error carrying what().
using OpFn = Val (*)(Js&);
struct Op {
  const char* name;
  OpFn fn;
};

// Every function the addon exports, in registration order.
const std::vector<Op>& Ops();

// Process-wide setup each adapter runs once before the first op.
void Init();

// The flag that aborts the running op when set non-zero (occ_kernel.cc).
void SetCancelFlag(volatile int32_t* flag);

}  // namespace occjs
