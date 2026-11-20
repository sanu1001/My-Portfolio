/*
  GlassBG: the background and the glass panels, drawn on the GPU in one pass.

  Why this exists: the old site used CSS backdrop-filter on big panels sitting
  over moving circles. The browser had to re-blur the whole panel every frame,
  which is what made scrolling lag. Here the circles are drawn by a shader, so
  "blur" is free (a soft edge is just a wider smoothstep), and the glass edge,
  refraction, colour split and highlights are computed per pixel in the same
  pass. No backdrop-filter anywhere.

  Backends, in order: WebGPU (WGSL) -> WebGL2 (GLSL) -> null (CSS fallback).
  Software renderers are skipped (CSS is faster there).
  Force one for testing with ?gl=webgpu, ?gl=webgl or ?gl=off.

  Uniform layout (92 floats, std140 compatible, all vec4):
    a      : viewport width, height (CSS px), time (s), render scale
    b      : pointer x, y (CSS px), panel count, unused
    c[3]   : circle centre x, y, radius, vertical stretch
    k[3]   : circle colour r, g, b, alpha
    w[3]   : circle edge wobble weights (2nd and 3rd harmonics)
    r[6]   : panel rect x, y, w, h (CSS px)
    s[6]   : panel corner radius, opacity, pointer light, unused
*/
(function () {
  'use strict';

  const WGSL = /* wgsl */ `
struct U {
  a: vec4f,
  b: vec4f,
  c: array<vec4f, 3>,
  k: array<vec4f, 3>,
  w: array<vec4f, 3>,
  r: array<vec4f, 6>,
  s: array<vec4f, 6>,
};
@group(0) @binding(0) var<uniform> u: U;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// A disc whose edge breathes: 2nd and 3rd angular harmonics with
// time-varying weights from the CPU (w), so no sin/cos per pixel.
fn blob(p: vec2f, c: vec4f, w: vec4f, soft: f32) -> f32 {
  var d = p - c.xy;
  d.y = d.y / c.w;
  let len = length(d);
  let n = d / max(len, 0.001);
  let h = w.x * (n.x * n.x - n.y * n.y) + w.y * (2.0 * n.x * n.y)
        + w.z * (n.x * (4.0 * n.x * n.x - 3.0)) + w.w * (n.y * (3.0 - 4.0 * n.y * n.y));
  return 1.0 - smoothstep(-soft, soft, len - c.z * (1.0 + h));
}

fn scene(p: vec2f, soft: f32) -> vec3f {
  var col = vec3f(0.0392);
  for (var i = 0; i < 3; i++) {
    col = mix(col, u.k[i].rgb, u.k[i].a * blob(p, u.c[i], u.w[i], soft));
  }
  return col;
}

fn sdRR(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn shade(p: vec2f, fpx: vec2f) -> vec3f {
  let n = i32(u.b.z);
  var best = 1e9;
  var bi = -1;
  var inside = -1;
  for (var i = 0; i < 6; i++) {
    if (i >= n) { break; }
    let R = u.r[i];
    let h = R.zw * 0.5;
    let d = sdRR(p - (R.xy + h), h, u.s[i].x);
    if (d < 0.0) { inside = i; }
    if (d < best) { best = d; bi = i; }
  }
  if (inside >= 0) {
    bi = inside;
    let R = u.r[bi];
    let h = R.zw * 0.5;
    best = sdRR(p - (R.xy + h), h, u.s[bi].x);
  }

  var col: vec3f;
  if (bi >= 0 && best < 0.0) {
    let R = u.r[bi];
    let S = u.s[bi];
    let h = R.zw * 0.5;
    let depth = -best;
    var g: vec3f;
    var edge = vec3f(0.0);
    if (depth < 32.0) {
      // Near the edge: bend the background like a rounded glass bezel,
      // split the colours slightly, and catch the light on the rim.
      let q = p - (R.xy + h);
      let e = vec2f(1.0, 0.0);
      let gx = sdRR(q + e.xy, h, S.x) - sdRR(q - e.xy, h, S.x);
      let gy = sdRR(q + e.yx, h, S.x) - sdRR(q - e.yx, h, S.x);
      let nrm = normalize(vec2f(gx, gy) + vec2f(0.00001));
      let bezel = min(30.0, min(h.x, h.y) * 0.5);
      let x = clamp(1.0 - depth / bezel, 0.0, 1.0);
      let lens = 1.0 - sqrt(max(1.0 - x * x, 0.0));
      let soft = mix(0.8, 44.0, smoothstep(0.0, 2.0, depth));
      if (lens > 0.002) {
        let off = nrm * lens * 46.0;
        g = vec3f(scene(p - off * 1.08, soft).r, scene(p - off, soft).g, scene(p - off * 0.92, soft).b);
      } else {
        g = scene(p, soft);
      }
      let L = normalize(vec2f(-0.55, -0.85));
      let f = dot(nrm, L);
      let rim = 1.0 - smoothstep(0.0, 2.5, depth);
      let glow = 1.0 - smoothstep(0.0, 22.0, depth);
      let fp = max(f, 0.0);
      let fn2 = max(-f, 0.0);
      edge = vec3f(rim * (0.5 * fp * fp + 0.22 * fn2 * fn2) + glow * glow * 0.05 * (0.4 + 0.6 * abs(f)));
    } else {
      // Deep inside: just frosted (a wide soft edge is an exact blur of a disc).
      g = scene(p, 44.0);
    }
    let lum = dot(g, vec3f(0.2126, 0.7152, 0.0722));
    g = mix(vec3f(lum), g, 1.22) * 0.86 + vec3f(0.028) + edge;
    let vy = clamp((p.y - R.y) / max(R.w, 1.0), 0.0, 1.0);
    g += vec3f(0.035) * (1.0 - smoothstep(0.0, 0.45, vy));
    let dm = p - u.b.xy;
    let fall = max(0.0, 1.0 - dot(dm, dm) / 250000.0);
    g += vec3f(0.05 * fall * fall * S.z);
    if (S.y < 0.999) {
      col = mix(scene(p, 0.8), g, S.y);
    } else {
      col = g;
    }
  } else {
    col = scene(p, 0.8);
    if (bi >= 0) {
      let sh = 1.0 - smoothstep(0.0, 36.0, best);
      col = col * (1.0 - 0.5 * sh * sh * u.s[bi].y);
    }
  }
  let ign = fract(52.9829189 * fract(dot(fpx, vec2f(0.06711056, 0.00583715))));
  return col + vec3f((ign - 0.5) * (2.0 / 255.0));
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  return vec4f(shade(fc.xy / u.a.w, fc.xy), 1.0);
}
`;

  const GLSL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const GLSL_FS = `#version 300 es
precision highp float;
layout(std140) uniform U {
  vec4 uA;
  vec4 uB;
  vec4 uC[3];
  vec4 uK[3];
  vec4 uW[3];
  vec4 uR[6];
  vec4 uS[6];
};
uniform float uCanvasH;
out vec4 outColor;

float blob(vec2 p, vec4 c, vec4 w, float soft) {
  vec2 d = p - c.xy;
  d.y = d.y / c.w;
  float len = length(d);
  vec2 n = d / max(len, 0.001);
  float h = w.x * (n.x * n.x - n.y * n.y) + w.y * (2.0 * n.x * n.y)
          + w.z * (n.x * (4.0 * n.x * n.x - 3.0)) + w.w * (n.y * (3.0 - 4.0 * n.y * n.y));
  return 1.0 - smoothstep(-soft, soft, len - c.z * (1.0 + h));
}

vec3 scene(vec2 p, float soft) {
  vec3 col = vec3(0.0392);
  for (int i = 0; i < 3; i++) {
    col = mix(col, uK[i].rgb, uK[i].a * blob(p, uC[i], uW[i], soft));
  }
  return col;
}

float sdRR(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

vec3 shade(vec2 p, vec2 fpx) {
  int n = int(uB.z);
  float best = 1e9;
  int bi = -1;
  int inside = -1;
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    vec4 R = uR[i];
    vec2 h = R.zw * 0.5;
    float d = sdRR(p - (R.xy + h), h, uS[i].x);
    if (d < 0.0) inside = i;
    if (d < best) { best = d; bi = i; }
  }
  if (inside >= 0) {
    bi = inside;
    vec4 R = uR[bi];
    vec2 h = R.zw * 0.5;
    best = sdRR(p - (R.xy + h), h, uS[bi].x);
  }

  vec3 col;
  if (bi >= 0 && best < 0.0) {
    vec4 R = uR[bi];
    vec4 S = uS[bi];
    vec2 h = R.zw * 0.5;
    float depth = -best;
    vec3 g;
    vec3 edge = vec3(0.0);
    if (depth < 32.0) {
      vec2 q = p - (R.xy + h);
      vec2 e = vec2(1.0, 0.0);
      float gx = sdRR(q + e.xy, h, S.x) - sdRR(q - e.xy, h, S.x);
      float gy = sdRR(q + e.yx, h, S.x) - sdRR(q - e.yx, h, S.x);
      vec2 nrm = normalize(vec2(gx, gy) + vec2(0.00001));
      float bezel = min(30.0, min(h.x, h.y) * 0.5);
      float x = clamp(1.0 - depth / bezel, 0.0, 1.0);
      float lens = 1.0 - sqrt(max(1.0 - x * x, 0.0));
      float soft = mix(0.8, 44.0, smoothstep(0.0, 2.0, depth));
      if (lens > 0.002) {
        vec2 off = nrm * lens * 46.0;
        g = vec3(scene(p - off * 1.08, soft).r, scene(p - off, soft).g, scene(p - off * 0.92, soft).b);
      } else {
        g = scene(p, soft);
      }
      vec2 L = normalize(vec2(-0.55, -0.85));
      float f = dot(nrm, L);
      float rim = 1.0 - smoothstep(0.0, 2.5, depth);
      float glow = 1.0 - smoothstep(0.0, 22.0, depth);
      float fp = max(f, 0.0);
      float fn2 = max(-f, 0.0);
      edge = vec3(rim * (0.5 * fp * fp + 0.22 * fn2 * fn2) + glow * glow * 0.05 * (0.4 + 0.6 * abs(f)));
    } else {
      g = scene(p, 44.0);
    }
    float lum = dot(g, vec3(0.2126, 0.7152, 0.0722));
    g = mix(vec3(lum), g, 1.22) * 0.86 + vec3(0.028) + edge;
    float vy = clamp((p.y - R.y) / max(R.w, 1.0), 0.0, 1.0);
    g += vec3(0.035) * (1.0 - smoothstep(0.0, 0.45, vy));
    vec2 dm = p - uB.xy;
    float fall = max(0.0, 1.0 - dot(dm, dm) / 250000.0);
    g += vec3(0.05 * fall * fall * S.z);
    col = S.y < 0.999 ? mix(scene(p, 0.8), g, S.y) : g;
  } else {
    col = scene(p, 0.8);
    if (bi >= 0) {
      float sh = 1.0 - smoothstep(0.0, 36.0, best);
      col *= 1.0 - 0.5 * sh * sh * uS[bi].y;
    }
  }
  float ign = fract(52.9829189 * fract(dot(fpx, vec2(0.06711056, 0.00583715))));
  return col + vec3((ign - 0.5) * (2.0 / 255.0));
}

void main() {
  vec2 fpx = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  outColor = vec4(shade(fpx / uA.w, fpx), 1.0);
}`;

  const UBO_BYTES = 92 * 4;

  // Software renderers (no GPU, or GPU blocklisted) run this shader on the
  // CPU, which is far slower than the plain CSS fallback. Detect and bail.
  const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

  async function createWebGPU(canvas, allowSoftware) {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const info = adapter.info || {};
    const desc = [info.vendor, info.architecture, info.device, info.description].join(' ');
    if (!allowSoftware && (adapter.isFallbackAdapter || info.isFallbackAdapter || SOFTWARE.test(desc))) return null;
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ code: WGSL });
    if (module.getCompilationInfo) {
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === 'error');
      if (errors.length) {
        console.warn('[glass] WGSL errors', errors.map((m) => m.lineNum + ': ' + m.message).join('\n'));
        return null;
      }
    }
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const ubo = device.createBuffer({ size: UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubo } }],
    });

    const api = {
      kind: 'webgpu',
      lost: false,
      onlost: null,
      render(data) {
        if (api.lost) return;
        device.queue.writeBuffer(ubo, 0, data.buffer, data.byteOffset, UBO_BYTES);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.039, g: 0.039, b: 0.039, a: 1 },
          }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
      },
    };
    device.lost.then((info) => {
      api.lost = true;
      console.warn('[glass] WebGPU device lost', info && info.message);
      if (api.onlost) api.onlost();
    });
    // Render once now so we fail early (inside create) rather than mid-session.
    api.render(new Float32Array(92));
    await device.queue.onSubmittedWorkDone();
    return api;
  }

  function createWebGL(canvas, allowSoftware) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default',
      failIfMajorPerformanceCaveat: !allowSoftware,
    });
    if (!gl) return null;
    if (!allowSoftware) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (SOFTWARE.test(String(name))) return null;
    }
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[glass] GLSL error', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, GLSL_VS);
    const fs = compile(gl.FRAGMENT_SHADER, GLSL_FS);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[glass] link error', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);
    const blockIndex = gl.getUniformBlockIndex(prog, 'U');
    gl.uniformBlockBinding(prog, blockIndex, 0);
    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, UBO_BYTES, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    const locH = gl.getUniformLocation(prog, 'uCanvasH');
    gl.bindVertexArray(gl.createVertexArray());
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const api = {
      kind: 'webgl2',
      lost: false,
      onlost: null,
      render(data) {
        if (api.lost) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data);
        gl.uniform1f(locH, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      api.lost = true;
      if (api.onlost) api.onlost();
    });
    return api;
  }

  async function create(canvas) {
    const force = new URLSearchParams(location.search).get('gl');
    if (force === 'off') return null;
    if (force !== 'webgl') {
      try {
        const r = await createWebGPU(canvas, force === 'webgpu');
        if (r) { r.canvas = canvas; return r; }
      } catch (err) {
        console.warn('[glass] WebGPU unavailable, trying WebGL2', err);
      }
      if (force === 'webgpu') return null;
    }
    // A canvas that already handed out a WebGPU context cannot give WebGL2,
    // so swap in a fresh canvas element if needed.
    let target = canvas;
    if (navigator.gpu && force !== 'webgl') {
      target = canvas.cloneNode(false);
      canvas.replaceWith(target);
    }
    try {
      const r = createWebGL(target, force === 'webgl');
      if (r) r.canvas = target;
      return r;
    } catch (err) {
      console.warn('[glass] WebGL2 unavailable', err);
      return null;
    }
  }

  window.GlassBG = { create };
})();
