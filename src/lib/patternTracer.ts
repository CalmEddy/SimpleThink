/* eslint-disable no-console */
type AnyFn = (...args: any[]) => any;

// Detect POS:Word patterns (like NOUN:Life) - now that : is only used for debug patterns
const DEBUG_PATTERN_REGEX =
  /\b(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[A-Z][a-zA-Z0-9]*(?:-(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[A-Z][a-zA-Z0-9]*)+\b/;

function traceHere(label: string, payload: unknown) {
  try {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (typeof s === 'string' && DEBUG_PATTERN_REGEX.test(s)) {
      const err = new Error(`[Pattern Debug] ${label}`);
      console.warn(`[Pattern Debug] ${label}:`, s.slice(0, 500));
      console.warn(err.stack || '');
    }
  } catch {}
}

function wrapMethod<T extends object, K extends keyof T>(
  obj: T, key: K, label: string,
  handler: (orig: AnyFn, thisArg: any, args: any[]) => any
) {
  const orig = (obj as any)[key] as AnyFn;
  if (typeof orig !== 'function') return;
  const wrapped = new Proxy(orig, {
    apply(target, thisArg, args) {
      try { return handler(target, thisArg, args); } catch { return (target as any).apply(thisArg, args); }
    },
  });
  Object.defineProperty(obj, key, { value: wrapped, configurable: true });
}

function wrapSetter<T extends object, K extends keyof T>(proto: T, key: K, label: string) {
  const desc = Object.getOwnPropertyDescriptor(proto, key as string);
  if (!desc || !desc.set) return;
  const origSet = desc.set!;
  Object.defineProperty(proto, key, {
    ...desc,
    set: function (v: any) {
      if (typeof v === 'string' && DEBUG_PATTERN_REGEX.test(v)) traceHere(`${label} setter`, v);
      return origSet.call(this, v);
    },
    configurable: true,
  });
}

export function attachPatternTracer() {
  console.log('[Pattern Debug] Pattern Tracer activated!');

  // String creation sites
  wrapMethod(String.prototype as any, 'concat', 'String.concat', (o, th, a) => {
    const r = o.apply(th, a); if (typeof r === 'string') traceHere('String.concat result', r); return r;
  });
  wrapMethod(Array.prototype as any, 'join', 'Array.join', (o, th, a) => {
    const r = o.apply(th, a); if (typeof r === 'string') traceHere('Array.join result', r); return r;
  });
  wrapMethod(Array.prototype as any, 'reduce', 'Array.reduce', (o, th, a) => {
    let sawString = false; const user = a[0];
    const wrapped = function (acc: any, cur: any, i: number, arr: any[]) {
      const next = (user as AnyFn)(acc, cur, i, arr);
      if (!sawString && (typeof next === 'string' || typeof acc === 'string' || typeof cur === 'string')) sawString = true;
      return next;
    };
    const r = o.apply(th, [wrapped, ...a.slice(1)]);
    if (sawString && typeof r === 'string') traceHere('Array.reduce result', r);
    return r;
  });
  wrapMethod(String.prototype as any, 'replace', 'String.replace', (o, th, a) => {
    const r = o.apply(th, a); if (typeof r === 'string') traceHere('String.replace result', r); return r;
  });
  wrapMethod(String.prototype as any, 'split', 'String.split', (o, th, a) => {
    const r = o.apply(th, a);
    if (Array.isArray(r)) for (const s of r) if (typeof s === 'string' && DEBUG_PATTERN_REGEX.test(s)) { traceHere('String.split segment', s); break; }
    return r;
  });

  // React.createElement child strings
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = (window as any).React || require('react');
    if (React && React.createElement) {
      wrapMethod(React as any, 'createElement', 'React.createElement', (o, th, a) => {
        const [, , ...kids] = a;
        for (const c of kids) {
          if (typeof c === 'string' && DEBUG_PATTERN_REGEX.test(c)) traceHere('React.createElement child', c);
          else if (Array.isArray(c)) for (const cc of c) if (typeof cc === 'string' && DEBUG_PATTERN_REGEX.test(cc)) { traceHere('React.createElement child[]', cc); break; }
        }
        return o.apply(th, a);
      });
    }
  } catch {}

  // DOM sinks
  wrapSetter(Element.prototype as any, 'innerHTML', 'innerHTML');
  wrapSetter(Node.prototype as any, 'textContent', 'textContent');

  const iah = (Element.prototype as any).insertAdjacentHTML as AnyFn;
  if (iah) Element.prototype.insertAdjacentHTML = new Proxy(iah, {
    apply(t, th, a: any[]) { const [, html] = a; if (typeof html === 'string') traceHere('insertAdjacentHTML', html); return Reflect.apply(t, th, a); },
  }) as any;

  (['appendChild', 'insertBefore', 'replaceChild'] as const).forEach((k) => {
    const orig = (Node.prototype as any)[k] as AnyFn;
    if (!orig) return;
    (Node.prototype as any)[k] = new Proxy(orig, {
      apply(t, th, a: any[]) {
        const node = a[0];
        try {
          if (node?.nodeType === Node.TEXT_NODE) {
            const v = (node as any).nodeValue; if (typeof v === 'string') traceHere(`Node.${k} (text)`, v);
          } else if (node?.nodeType === Node.ELEMENT_NODE) {
            const txt = (node as HTMLElement).innerText || (node as HTMLElement).textContent || '';
            if (typeof txt === 'string') traceHere(`Node.${k} (element)`, txt);
          }
        } catch {}
        return Reflect.apply(t, th, a);
      },
    });
  });
}