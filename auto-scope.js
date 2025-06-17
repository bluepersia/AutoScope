const allCombisKeys = ['*', '>', '+', '~', ',', '|'];

function stripPseudoSelectors(selector) {
  return selector.replace(/::?[a-zA-Z0-9\-\_()]+/g, '');
}
function waitForMap(checkInterval = 100) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (map) {
        clearInterval(interval);
        resolve();
      }
    }, checkInterval);
  });
}

let map;
let isLoading;
async function loadMap(url) {
  if (map) return map;

  if (isLoading) await waitForMap();

  isLoading = true;

  url =
    url ||
    window.autoScopeMapUrl ||
    document.querySelector('[data-auto-scope-map-url]')?.dataset
      .autoScopeMapUrl ||
    `/auto-scope-runtime-map.json`;
  const res = await fetch(url);

  map = await res.json();

  return map;
}
const metaTags = [...document.head.children].filter((tag) =>
  tag.tagName === 'META' && tag.name.startsWith('auto-scope') ? true : false
);

metaTags.forEach((tag) => {
  const scopeId = tag.name.includes('auto-scope-')
    ? tag.name.split('auto-scope-')[1]
    : '';

  tag.scopeId = scopeId;
});

let mapImported = new Set();

function processElement(el, importedScope, maps) {
  const scopeName = importedScope.scopeName;
  const scopeHash = `${importedScope.hashedName}`;
  const useFlat = importedScope.selectors[0].flat !== undefined;
  const stripClasses =
    !importedScope.hasOwnProperty('stripClasses') || importedScope.stripClasses;

  if (!useFlat) {
    el.stripClasses = stripClasses;
    el.newClasses = el.className
      .split(' ')
      .map((cls) => cls.replace(scopeName, scopeHash));
  }
  // — build nested‑subscope roots as before —
  const nestedSubscopeRoots = new Set();
  for (const otherScope of maps) {
    //if (otherScope.scopeName === scopeName) continue;

    /*
    if (!useFlat)
    {
      const subscopeEls = el.querySelectorAll (`.${otherScope.scopeName}`);

      subscopeEls.forEach (subEl =>
      {
        subEl.sub = otherScope.scopeName;
      }
      )
      continue;
    }*/

    for (const rootEl of el.querySelectorAll(`.${otherScope.scopeName}`)) {
      if (!otherScope.scopeId|| rootEl.dataset.scope == otherScope.scopeId) {
        nestedSubscopeRoots.add(rootEl);
      }
    }
  }

  //if (!useFlat)
  //return [el];

  // — emulate :scope via a temp attribute —
  const TMP = '__SCOPE_TMP__';
  el.setAttribute(TMP, '');

  // — build your selector → (raw, childSel, newClass) map —
  const selMap = importedScope.selectors.map(({ raw, flat }) => {
    const newClass = flat;
    const childSel = raw
      .replace(`.${scopeName}`, ':scope')
      .replace(/:scope/g, `[${TMP}]`);

    return { raw, childSel, newClass };
  });

  const toMutate = new Set();

  function markMutate(el) {
    if (!el.newClasses) {
      el.newClasses = [];
      el.exclude = [];
      el.stripClasses = stripClasses;
      el.scopeName = scopeName;
      el.scopeHash = scopeHash;
    }
    toMutate.add(el);
  }

  markMutate(el);

  function matchEl(el, raw, newClass) {

    if (typeof newClass === 'object')
    {
      return;
    }
    else 
    if (el.matches(stripPseudoSelectors(raw))) {
      if (typeof newClass === 'object') {
        markMutate(el);
        el.newClasses.push(newClass.replaceAll('.', ''));
    }
  }
  }

  function addHashToBEMName(el, ignoreArr = []) {
    const classes = el.className.split(' ').map((cls) => {
      if (ignoreArr.includes(cls) || el.exclude.includes(cls)) return cls;

      if (cls === scopeName) return scopeHash;

      if (cls.startsWith(`${scopeName}__`))
        return cls.replace(`${scopeName}__`, `${scopeHash}__`);

      return cls;
    });

    el.className = classes.join(' ');
  }

  function processExclusion(el) {
    if (!('exclude' in el.dataset)) return false;

    const arr = el.dataset.exclude?.split(',') || [];

    markMutate(el);
    if (arr.length === 0) {
      el.newClasses = [...el.classList];
    } else {
      el.exclude = [...el.classList].filter((cls) => arr.includes(cls));
    }

    return true;
  }

  processExclusion(el);
  if (useFlat) {
    // — check the root itself —
    for (const { raw, newClass } of selMap) {
      if (typeof newClass === 'object')
      {
        const chain = newClass.chain;
        const flatChain = newClass.flatChain;

      selectSeg (0, el);
      function selectSeg (index, node)
      {
        if (index >= chain.length)
          return;
        
        node.querySelectorAll (`:scope ${chain[index]}`).forEach (match => 
        {
          markMutate (match);
          match.newClasses.push (flatChain[index]);
          selectSeg (index + 1, match)
        }
        )
      }
    }
      else 
      matchEl(el, raw, newClass);
    }
  } else addHashToBEMName(el);

  if (!devMode) {
    // — walk **all** descendants just once —
    const desc = el.querySelectorAll('*');

    const isDescendantOf = (node, parents) => {
      while (node.parentNode && node.parentElement !== el) {
        if (parents.has(node.parentNode)) return true;
        node = node.parentNode;
      }
      return false;
    };

    // Track elements and descendants to skip
    const ignoreScopeElements = new Set();
    const ignoreScopeClassMap = new WeakMap();

    // — find all elements with data-break —
    for (const node of desc) {
      const attr = node.getAttribute('data-break');

      if (attr !== null) {
        ignoreScopeElements.add(node);

        if (attr.trim() !== '') {
          const ignoreClasses = attr
            .split(',')
            .map((cls) => cls.trim())
            .filter(Boolean);
          ignoreScopeClassMap.set(node, new Set(ignoreClasses));
        }
      }
    }

    // — utility to check if a node is inside any ignored subtree —
    const isInsideIgnoredScope = (node) => {
      while (node.parentElement) {
        if (ignoreScopeElements.has(node.parentElement)) return true;
        node = node.parentElement;
      }
      return false;
    };

    for (const descEl of desc) {
      processExclusion(descEl);

      if (isDescendantOf(descEl, nestedSubscopeRoots)) continue;

      if (isInsideIgnoredScope(descEl)) continue;

      const isIgnoreScope = ignoreScopeElements.has(descEl);

      let ignoreArr = descEl.dataset.break
        ? descEl.dataset.break.split(',')
        : isIgnoreScope
        ? [...descEl.classList]
        : [];

      if (useFlat) {
        if (ignoreArr.length > 0) {
          markMutate(descEl);
          el.newClasses.push(...ignoreArr);
        }
        for (const { childSel, newClass } of selMap) {
          const isScopeSel = childSel === `.${scopeName}` || childSel.startsWith(`.${scopeName}.`) || childSel.startsWith (`.${scopeName}--`) || childSel.startsWith (`.${scopeName}:`);
          if (isScopeSel) continue;
          if (ignoreArr.find((val) => childSel.endsWith(`.${val}`))) continue;

          matchEl(descEl, childSel, newClass);
        }
      } else addHashToBEMName(descEl, ignoreArr);
    }
  }

  // — cleanup —
  el.removeAttribute(TMP);

  return toMutate;
}

function processEl(el, hash = '', scopeId = '') {
  let toMutate = new Array();

  let maps = mapImported;

  if (hash) {
    if (!Array.isArray(hash)) hash = [hash];

    if (!scopeId) scopeId = new Array(hash.length).fill('');
    else if (!Array.isArray(scopeId)) scopeId = [scopeId];

    maps = [];
    for (const [index, h] of hash.entries())
      maps.push({ ...map[h], scopeId: scopeId[index] });
  }
  for (const importedScope of maps) {
    const matches = el.parentElement.querySelectorAll(
      `.${importedScope.scopeName}`
    );

    for (const match of matches) {
      if (!importedScope.scopeId || match.dataset.scope == importedScope.scopeId)
        toMutate.push(...processElement(match, importedScope, maps));
    }
    continue;
  }

  toMutate = Array.from(new Set(toMutate));
  // — commit classes —
  toMutate.forEach((n) => {
    if (!n.stripClasses) {
      // Preserve original class names and add new ones
      const originalClasses = Array.from(n.classList).map((cls) =>
        cls.includes('__') || cls.includes(`${n.scopeHash}`)
          ? cls
          : cls === n.scopeName
          ? n.scopeHash
          : `${n.scopeHash}__${cls}`
      );

      n.className = Array.from(
        new Set([...originalClasses, ...n.newClasses])
      ).join(' ');
    } else {
      // Replace classes entirely
      n.className = [...n.newClasses, ...n.exclude].join(' ');
    }

    delete n.newClasses;
    delete n.stripClasses;
    delete n.scopeName;
    delete n.scopeHash;
    if (n.sub) n.classList.add(n.sub);

    delete n.sub;
  });
}

let devMode = false;

export { processEl, processElement };

export { init };

let isInitialized;
async function init(url = null, metaTs = null) {
  await loadMap(url);

  if (metaTs) {
    metaTs = metaTs.map((val) =>
      typeof val === 'object' ? val : { content: val, scopeId: '' }
    );

    for (const tag of metaTs)
      mapImported.add({ ...map[tag.content], scopeId: tag.scopeId });

    return;
  }
  if (isInitialized) return;

  const htmlTags = metaTags.map((metaTag) => {
    return { ...map[metaTag.content], scopeId: metaTag.scopeId };
  });

  for (const tag of htmlTags) mapImported.add(tag);

  isInitialized = true;
}
/**
 * Observe the DOM for added *and* removed elements in one observer.
 *
 * @param {Object}   handlers
 * @param {function(Element[]):void} [handlers.onAdded]
 *   Called once per batch with an array of newly added Element nodes.
 * @param {function(Element[]):void} [handlers.onRemoved]
 *   Called once per batch with an array of removed Element nodes.
 * @param {Element|Document} [root=document.body]
 *   The subtree root to watch. Defaults to document.body.
 * @returns {MutationObserver}
 *   The observer instance (call .disconnect() to stop).
 */
function observeDomChanges({ onAdded = () => {} }, root = document.body) {
  const observer = new MutationObserver((mutations) => {
    const added = [];

    for (const mutation of mutations) {
      // Collect added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          added.push(node);
        }
      }
    }

    if (added.length > 0) onAdded(added);
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
  });

  return observer;
}

function initAutoProcess() {
  observeDomChanges({
    onAdded(addedRoots) {
      const toMutate = addedRoots.forEach((root) => {
        if (!(root instanceof Element)) return;

        // if *that root* is itself a scope:
        processEl(root);
      });
    },
  });
}

export { initAutoProcess };

function getModifierClass(el, base, modifier) {
  const classList = Array.from(el.classList);

  const regex = /^([a-zA-Z0-9-]+)(?:__([a-zA-Z0-9-]+))?$/;

  for (const className of classList) {
    const match = className.match(regex);

    if (!match) continue;

    const basePart = match[1]; // e.g. "rating-card-h1"
    const elementPart = match[2]; // e.g. "option" (if any)

    if (elementPart === base) {
      return `${basePart}__${elementPart}--${modifier}`;
    }

    if (!elementPart && basePart === base) {
      return `${basePart}--${modifier}`;
    }
  }

  return null;
}

export { getModifierClass };
