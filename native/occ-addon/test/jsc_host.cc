// Runs a CommonJS script under JavaScriptCore with the OCC ops installed
// through jsc_binding.cc -- the engine and adapter the iPad will use -- so the
// unchanged occ-bridge.cjs can be checked against the N-API build on a Mac.
//
//   occ_jsc_host <script.cjs> [args...]
//
// require() serves "path" (join/dirname only), the addon (any path ending in
// occ_addon.node) and .cjs/.js files by absolute or relative path.  Like
// Node, the script sees process.argv; console.log writes a line to stdout.
// Exit status 1 when the script throws.
#include <JavaScriptCore/JavaScriptCore.h>

#include <climits>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

#include "../src/jsc_binding.h"

namespace {

std::string Utf8(JSContextRef ctx, JSValueRef v) {
  JSStringRef s = JSValueToStringCopy(ctx, v, nullptr);
  if (!s) return "";
  const size_t max = JSStringGetMaximumUTF8CStringSize(s);
  std::string out(max, '\0');
  out.resize(JSStringGetUTF8CString(s, out.data(), max) - 1);
  JSStringRelease(s);
  return out;
}

JSValueRef Str(JSContextRef ctx, const std::string& s) {
  JSStringRef r = JSStringCreateWithUTF8CString(s.c_str());
  JSValueRef v = JSValueMakeString(ctx, r);
  JSStringRelease(r);
  return v;
}

JSValueRef Log(JSContextRef ctx, JSObjectRef, JSObjectRef, size_t argc,
               const JSValueRef argv[], JSValueRef*) {
  std::string line;
  for (size_t i = 0; i < argc; i++) {
    if (i) line += ' ';
    line += Utf8(ctx, argv[i]);
  }
  printf("%s\n", line.c_str());
  fflush(stdout);
  return JSValueMakeUndefined(ctx);
}

JSValueRef ReadFile(JSContextRef ctx, JSObjectRef, JSObjectRef, size_t argc,
                    const JSValueRef argv[], JSValueRef* exception) {
  const std::string path = argc ? Utf8(ctx, argv[0]) : "";
  std::ifstream f(path, std::ios::binary);
  if (!f) {
    JSValueRef msg = Str(ctx, "cannot read " + path);
    *exception = JSObjectMakeError(ctx, 1, &msg, nullptr);
    return JSValueMakeUndefined(ctx);
  }
  std::stringstream ss;
  ss << f.rdbuf();
  return Str(ctx, ss.str());
}

void SetFn(JSContextRef ctx, JSObjectRef obj, const char* name,
           JSObjectCallAsFunctionCallback fn) {
  JSStringRef n = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(ctx, obj, n, JSObjectMakeFunctionWithCallback(ctx, n, fn),
                      kJSPropertyAttributeNone, nullptr);
  JSStringRelease(n);
}

void SetVal(JSContextRef ctx, JSObjectRef obj, const char* name, JSValueRef v) {
  JSStringRef n = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(ctx, obj, n, v, kJSPropertyAttributeNone, nullptr);
  JSStringRelease(n);
}

// The module loader, in JavaScript: the bridge needs nothing more.
const char* kPrelude = R"JS(
(function (g) {
  const cache = {};
  const dirname = (p) => p.replace(/\/[^/]*$/, "") || "/";
  const normalize = (p) => {
    const out = [];
    for (const s of p.split("/")) {
      if (s === "..") out.pop();
      else if (s !== "." && s !== "") out.push(s);
    }
    return "/" + out.join("/");
  };
  const path = {
    join: (...parts) => normalize(parts.join("/")),
    dirname,
  };
  function load(file) {
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} };
    cache[file] = module;
    const fn = new Function("module", "exports", "require", "__dirname",
                            "__filename", g.__readFile(file));
    fn(module, module.exports, (p) => req(p, dirname(file)), dirname(file),
       file);
    return module.exports;
  }
  function req(p, from) {
    if (p === "path") return path;
    if (p.endsWith("occ_addon.node")) return g.__occ;
    return load(p.startsWith("/") ? normalize(p) : normalize(from + "/" + p));
  }
  g.__load = load;
})(this);
)JS";

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: occ_jsc_host <script.cjs> [args...]\n");
    return 2;
  }
  JSGlobalContextRef ctx = JSGlobalContextCreate(nullptr);
  JSObjectRef global = JSContextGetGlobalObject(ctx);

  JSObjectRef console = JSObjectMake(ctx, nullptr, nullptr);
  SetFn(ctx, console, "log", Log);
  SetFn(ctx, console, "error", Log);
  SetVal(ctx, global, "console", console);
  SetFn(ctx, global, "__readFile", ReadFile);
  SetVal(ctx, global, "__occ", OccMakeAddon(ctx));

  JSValueRef args[64];
  int n = 0;
  args[n++] = Str(ctx, "occ_jsc_host");
  for (int i = 1; i < argc && n < 64; i++) args[n++] = Str(ctx, argv[i]);
  JSObjectRef process = JSObjectMake(ctx, nullptr, nullptr);
  SetVal(ctx, process, "argv", JSObjectMakeArray(ctx, n, args, nullptr));
  SetVal(ctx, global, "process", process);

  JSValueRef exc = nullptr;
  JSStringRef prelude = JSStringCreateWithUTF8CString(kPrelude);
  JSEvaluateScript(ctx, prelude, nullptr, nullptr, 1, &exc);
  JSStringRelease(prelude);
  if (!exc) {
    char real[PATH_MAX];
    const std::string script = realpath(argv[1], real) ? real : argv[1];
    std::string call = "__load(" + std::string("\"") + script + "\")";
    JSStringRef src = JSStringCreateWithUTF8CString(call.c_str());
    JSEvaluateScript(ctx, src, nullptr, nullptr, 1, &exc);
    JSStringRelease(src);
  }
  int status = 0;
  if (exc) {
    std::string stack;
    if (JSValueIsObject(ctx, exc)) {
      JSStringRef s = JSStringCreateWithUTF8CString("stack");
      JSValueRef st =
          JSObjectGetProperty(ctx, JSValueToObject(ctx, exc, nullptr), s, nullptr);
      JSStringRelease(s);
      if (JSValueIsString(ctx, st)) stack = Utf8(ctx, st);
    }
    fprintf(stderr, "uncaught: %s\n%s\n", Utf8(ctx, exc).c_str(), stack.c_str());
    status = 1;
  }
  JSGlobalContextRelease(ctx);
  return status;
}
