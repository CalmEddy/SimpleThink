/* eslint-disable no-console */

const DEBUG_PATTERN_REGEX =
  /\b(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[^\s-]+(?:-(?:ADJ|ADV|DET|NOUN|PROPN|PRON|VERB|ADP|CCONJ|SCONJ|PART|NUM|INTJ|PUNCT|SYM|X|AUX)\s*:\s*[^\s-]+)+\b/;

// Store original methods to avoid loops
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

export function attachSimplePatternTracer() {
  originalConsole.log('[Pattern Debug] Simple Pattern Tracer activated!');

  // Intercept Array.prototype.join
  const originalJoin = Array.prototype.join;
  Array.prototype.join = function(separator?: string) {
    const result = originalJoin.call(this, separator);
    
    if (typeof result === 'string' && DEBUG_PATTERN_REGEX.test(result)) {
      const stack = new Error().stack || '';
      originalConsole.warn('[Pattern Debug] Array.join created pattern:', result.slice(0, 200));
      originalConsole.warn('Stack trace:', stack);
    }
    
    return result;
  };

  // Intercept String.prototype.concat
  const originalConcat = String.prototype.concat;
  String.prototype.concat = function(...args: any[]) {
    const result = originalConcat.apply(this, args);
    
    if (typeof result === 'string' && DEBUG_PATTERN_REGEX.test(result)) {
      const stack = new Error().stack || '';
      originalConsole.warn('[Pattern Debug] String.concat created pattern:', result.slice(0, 200));
      originalConsole.warn('Stack trace:', stack);
    }
    
    return result;
  };

  // Intercept template literal creation by wrapping String constructor
  const originalString = String;
  (window as any).String = new Proxy(originalString, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      
      if (typeof result === 'string' && DEBUG_PATTERN_REGEX.test(result)) {
        const stack = new Error().stack || '';
        originalConsole.warn('[Pattern Debug] String constructor created pattern:', result.slice(0, 200));
        originalConsole.warn('Stack trace:', stack);
      }
      
      return result;
    }
  });

  // Intercept any function that might create patterns
  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(callback: any, delay?: number, ...args: any[]) {
    if (typeof callback === 'function') {
      const wrappedCallback = function(...cbArgs: any[]) {
        const result = callback.apply(this, cbArgs);
        
        if (typeof result === 'string' && DEBUG_PATTERN_REGEX.test(result)) {
          const stack = new Error().stack || '';
          originalConsole.warn('[Pattern Debug] setTimeout callback created pattern:', result.slice(0, 200));
          originalConsole.warn('Stack trace:', stack);
        }
        
        return result;
      };
      return originalSetTimeout.call(this, wrappedCallback, delay, ...args);
    }
    return originalSetTimeout.call(this, callback, delay, ...args);
  };

  // Intercept template literal creation by wrapping Function constructor
  const originalFunction = window.Function;
  window.Function = new Proxy(originalFunction, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      
      // Check if the function might create patterns
      const source = args[args.length - 1];
      if (typeof source === 'string' && source.includes('POS') && source.includes(':')) {
        originalConsole.warn('[Pattern Debug] Function created that might build patterns');
        originalConsole.warn('Function source:', source.slice(0, 200));
      }
      
      return result;
    }
  });

  // Enhanced DOM observer - show exactly where patterns are created
  const seenPatterns = new Set<string>();
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            const textContent = element.innerText;
            if (textContent && DEBUG_PATTERN_REGEX.test(textContent)) {
              // Only log each unique pattern once
              const pattern = textContent.match(DEBUG_PATTERN_REGEX)?.[0];
              if (pattern && !seenPatterns.has(pattern)) {
                seenPatterns.add(pattern);
                originalConsole.warn('[Pattern Debug] Pattern found in DOM:', pattern);
                originalConsole.warn('Element tag:', element.tagName);
                originalConsole.warn('Element classes:', element.className);
                originalConsole.warn('Element parent:', element.parentElement?.tagName, element.parentElement?.className);
                originalConsole.warn('Element innerHTML:', element.innerHTML.slice(0, 500));
                originalConsole.warn('Full element:', element);
                
                // Try to find the React component that created this
                const reactKey = (element as any)._reactInternalFiber || (element as any)._reactInternalInstance;
                if (reactKey) {
                  originalConsole.warn('React component:', reactKey);
                }
              }
            }
          }
        });
      }
    });
  });

  // Start observing after a delay
  setTimeout(() => {
    observer.observe(document.body, { childList: true, subtree: true });
  }, 1000);
}
