// Extracts design tokens and structural descriptions from Figma API data.

export function extractTokens(figmaData) {
  const tokens = { colors: [], fonts: [], gradients: [], effects: [], spacing: [] };

  const colorMap = new Map();
  const fontMap = new Map();
  const gradientMap = new Map();
  const spacingSet = new Set();

  function walkNode(node) {
    if (node.fills && Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.visible === false) continue;
        if (fill.type === 'SOLID' && fill.color) {
          const { r, g, b } = fill.color;
          const a = fill.opacity ?? fill.color.a ?? 1;
          const hex = rgbToHex(r, g, b);
          const key = a < 1 ? `${hex}@${a.toFixed(2)}` : hex;
          if (!colorMap.has(key)) {
            colorMap.set(key, {
              value: a < 1 ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a.toFixed(2)})` : hex,
              source: node.name,
            });
          }
        }
        if (fill.type === 'LINEAR_GRADIENT' || fill.type === 'RADIAL_GRADIENT') {
          const grad = describeGradient(fill, node.name);
          if (grad) {
            const key = grad.css;
            if (!gradientMap.has(key)) gradientMap.set(key, grad);
          }
        }
      }
    }

    if (node.strokes && Array.isArray(node.strokes)) {
      for (const stroke of node.strokes) {
        if (stroke.visible === false) continue;
        if (stroke.type === 'SOLID' && stroke.color) {
          const { r, g, b } = stroke.color;
          const a = stroke.opacity ?? stroke.color.a ?? 1;
          const hex = rgbToHex(r, g, b);
          const key = `stroke:${a < 1 ? `${hex}@${a.toFixed(2)}` : hex}`;
          if (!colorMap.has(key)) {
            colorMap.set(key, {
              value: a < 1 ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a.toFixed(2)})` : hex,
              source: node.name,
              usage: 'stroke',
            });
          }
        }
      }
    }

    if (node.type === 'TEXT' && node.style) {
      const s = node.style;
      const key = `${s.fontFamily}|${s.fontWeight}|${s.fontSize}`;
      if (!fontMap.has(key)) {
        fontMap.set(key, {
          family: s.fontFamily,
          weight: s.fontWeight,
          size: s.fontSize,
          lineHeight: s.lineHeightPx || null,
          letterSpacing: s.letterSpacing || 0,
          textAlign: s.textAlignHorizontal || null,
          textDecoration: s.textDecoration || null,
          textCase: s.textCase || null,
          source: node.name,
        });
      }
    }

    if (node.effects && Array.isArray(node.effects)) {
      for (const effect of node.effects) {
        if (effect.visible === false) continue;
        if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
          const { r, g, b, a } = effect.color || {};
          tokens.effects.push({
            type: effect.type.toLowerCase().replace('_', '-'),
            offset: { x: effect.offset?.x || 0, y: effect.offset?.y || 0 },
            radius: effect.radius || 0,
            spread: effect.spread || 0,
            color: r !== undefined ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${(a||1).toFixed(2)})` : null,
            source: node.name,
          });
        }
        if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
          tokens.effects.push({
            type: effect.type === 'BACKGROUND_BLUR' ? 'backdrop-blur' : 'blur',
            radius: effect.radius || 0,
            source: node.name,
          });
        }
      }
    }

    if (node.layoutMode) {
      const gap = node.itemSpacing || 0;
      const pads = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].filter(v => v > 0);
      if (gap > 0) spacingSet.add(gap);
      for (const p of pads) spacingSet.add(p);
    }

    if (node.children) {
      for (const child of node.children) walkNode(child);
    }
  }

  if (figmaData.document) walkNode(figmaData.document);

  tokens.colors = [...colorMap.values()];
  tokens.fonts = [...fontMap.values()];
  tokens.gradients = [...gradientMap.values()];
  tokens.spacing = [...spacingSet].sort((a, b) => a - b);

  return tokens;
}

export function extractStructure(figmaData, nodeId) {
  let target = nodeId ? findNode(figmaData.document, nodeId) : figmaData.document;
  if (!target) target = figmaData.document;
  if (!target) return [];

  const sections = [];

  function describeNode(node, depth = 0) {
    if (depth > 10) return null;

    const desc = { name: node.name, type: node.type };

    const box = node.absoluteBoundingBox || node.absoluteRenderBounds;
    if (box) {
      desc.size = { width: Math.round(box.width), height: Math.round(box.height) };
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      desc.opacity = +(node.opacity.toFixed(2));
    }

    if (node.visible === false) {
      desc.visible = false;
    }

    if (node.clipsContent) {
      desc.clip = true;
    }

    const fills = describeFills(node);
    if (fills) desc.fills = fills;

    const strokes = describeStrokes(node);
    if (strokes) desc.strokes = strokes;

    const radius = describeRadius(node);
    if (radius) desc.borderRadius = radius;

    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'GROUP') {
      desc.layout = describeLayout(node);
    }

    if (node.type === 'TEXT') {
      desc.text = node.characters || '';
      if (node.style) {
        const s = node.style;
        desc.font = {
          family: s.fontFamily,
          weight: s.fontWeight,
          size: s.fontSize,
          lineHeight: s.lineHeightPx || null,
          align: s.textAlignHorizontal || null,
        };
        if (s.textDecoration && s.textDecoration !== 'NONE') desc.font.decoration = s.textDecoration.toLowerCase();
        if (s.textCase && s.textCase !== 'ORIGINAL') desc.font.textCase = s.textCase.toLowerCase();
        if (s.letterSpacing) desc.font.letterSpacing = s.letterSpacing;
      }
    }

    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'LINE' || node.type === 'ELLIPSE' || node.type === 'REGULAR_POLYGON') {
      desc.isVector = true;
    }

    if (node.type === 'RECTANGLE' && hasImageFill(node)) {
      desc.hasImage = true;
    }
    if (node.fills?.some(f => f.type === 'IMAGE' && f.visible !== false)) {
      desc.hasImage = true;
    }

    if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      desc.isComponent = true;
      desc.componentName = node.name;
      if (node.type === 'INSTANCE' && node.componentId) {
        desc.instanceOf = node.componentId;
      }
    }

    if (node.constraints) {
      desc.constraints = {
        horizontal: node.constraints.horizontal,
        vertical: node.constraints.vertical,
      };
    }

    if (node.children && node.children.length) {
      desc.children = node.children
        .filter(c => c.visible !== false)
        .map(c => describeNode(c, depth + 1))
        .filter(Boolean);
    }

    return desc;
  }

  const topNodes = target.children || [target];
  for (const frame of topNodes) {
    const described = describeNode(frame);
    if (described) sections.push(described);
  }

  return sections;
}

function describeFills(node) {
  if (!node.fills || !Array.isArray(node.fills)) return null;
  const visible = node.fills.filter(f => f.visible !== false);
  if (!visible.length) return null;

  const results = [];
  for (const fill of visible) {
    if (fill.type === 'SOLID' && fill.color) {
      const { r, g, b } = fill.color;
      const a = fill.opacity ?? fill.color.a ?? 1;
      results.push({ type: 'solid', color: a < 1 ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a.toFixed(2)})` : rgbToHex(r, g, b) });
    } else if (fill.type === 'LINEAR_GRADIENT' || fill.type === 'RADIAL_GRADIENT') {
      const grad = describeGradient(fill, null);
      if (grad) results.push({ type: 'gradient', css: grad.css });
    } else if (fill.type === 'IMAGE') {
      results.push({ type: 'image', scaleMode: fill.scaleMode || 'FILL' });
    }
  }
  return results.length ? results : null;
}

function describeStrokes(node) {
  if (!node.strokes || !Array.isArray(node.strokes)) return null;
  const visible = node.strokes.filter(s => s.visible !== false);
  if (!visible.length) return null;

  const results = [];
  for (const stroke of visible) {
    if (stroke.type === 'SOLID' && stroke.color) {
      const { r, g, b } = stroke.color;
      const a = stroke.opacity ?? stroke.color.a ?? 1;
      results.push({
        color: a < 1 ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a.toFixed(2)})` : rgbToHex(r, g, b),
        weight: node.strokeWeight || 1,
        align: node.strokeAlign || 'INSIDE',
      });
    }
  }
  return results.length ? results : null;
}

function describeRadius(node) {
  if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    if (tl === tr && tr === br && br === bl) {
      return tl > 0 ? tl : null;
    }
    return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
  }
  return node.cornerRadius > 0 ? node.cornerRadius : null;
}

function describeGradient(fill, nodeName) {
  if (!fill.gradientStops || !fill.gradientStops.length) return null;
  const stops = fill.gradientStops.map(s => {
    const { r, g, b, a } = s.color;
    const color = a < 1
      ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a.toFixed(2)})`
      : rgbToHex(r, g, b);
    return `${color} ${Math.round(s.position * 100)}%`;
  }).join(', ');

  let angle = 180;
  if (fill.gradientHandlePositions && fill.gradientHandlePositions.length >= 2) {
    const [start, end] = fill.gradientHandlePositions;
    angle = Math.round(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI + 90);
    if (angle < 0) angle += 360;
  }

  const isRadial = fill.type === 'RADIAL_GRADIENT';
  const css = isRadial
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${angle}deg, ${stops})`;

  return { type: isRadial ? 'radial' : 'linear', css, source: nodeName };
}

function hasImageFill(node) {
  return node.fills?.some(f => f.type === 'IMAGE' && f.visible !== false);
}

function describeLayout(node) {
  const layout = {};
  if (node.layoutMode) {
    layout.direction = node.layoutMode === 'VERTICAL' ? 'column' : 'row';
    layout.gap = node.itemSpacing || 0;
    layout.padding = {
      top: node.paddingTop || 0,
      right: node.paddingRight || 0,
      bottom: node.paddingBottom || 0,
      left: node.paddingLeft || 0,
    };
    if (node.primaryAxisAlignItems) layout.justify = node.primaryAxisAlignItems.toLowerCase();
    if (node.counterAxisAlignItems) layout.align = node.counterAxisAlignItems.toLowerCase();
    if (node.layoutWrap === 'WRAP') layout.wrap = true;
    if (node.primaryAxisSizingMode) layout.mainAxisSizing = node.primaryAxisSizingMode.toLowerCase();
    if (node.counterAxisSizingMode) layout.crossAxisSizing = node.counterAxisSizingMode.toLowerCase();
  }
  return layout;
}

function findNode(node, id) {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function rgbToHex(r, g, b) {
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

export function tokensToDecisions(tokens) {
  const decisions = [];

  const colorNames = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border'];
  tokens.colors.slice(0, colorNames.length).forEach((c, i) => {
    decisions.push({
      kind: 'token',
      name: `color-${colorNames[i] || 'color-' + i}`,
      content: c.value,
      weight: 'guide',
      scope: 'global',
    });
  });

  const seen = new Set();
  for (const f of tokens.fonts) {
    const key = f.family;
    if (seen.has(key)) continue;
    seen.add(key);
    decisions.push({
      kind: 'token',
      name: `font-${seen.size === 1 ? 'heading' : seen.size === 2 ? 'body' : 'accent'}`,
      content: f.family,
      weight: 'guide',
      scope: 'global',
    });
  }

  for (const effect of tokens.effects.slice(0, 3)) {
    if (effect.type === 'drop-shadow' && effect.color) {
      decisions.push({
        kind: 'token',
        name: 'shadow-default',
        content: `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px${effect.spread ? ' ' + effect.spread + 'px' : ''} ${effect.color}`,
        weight: 'guide',
        scope: 'global',
      });
    }
    if (effect.type === 'backdrop-blur') {
      decisions.push({
        kind: 'token',
        name: 'backdrop-blur',
        content: `blur(${effect.radius}px)`,
        weight: 'guide',
        scope: 'global',
      });
    }
  }

  for (const grad of (tokens.gradients || []).slice(0, 3)) {
    decisions.push({
      kind: 'token',
      name: `gradient-${decisions.filter(d => d.name.startsWith('gradient')).length + 1}`,
      content: grad.css,
      weight: 'guide',
      scope: 'global',
    });
  }

  if (tokens.spacing.length >= 2) {
    const base = tokens.spacing[0];
    decisions.push({
      kind: 'token',
      name: 'spacing-scale',
      content: tokens.spacing.slice(0, 8).join(', ') + 'px',
      weight: 'guide',
      scope: 'global',
    });
  }

  return decisions;
}

export function structureToDescription(sections) {
  const lines = [];

  function describe(node, indent = 0) {
    const pad = '  '.repeat(indent);
    let line = `${pad}- ${node.name} (${node.type})`;

    if (node.isComponent) line += ' [COMPONENT]';
    if (node.visible === false) { lines.push(line + ' [HIDDEN]'); return; }
    if (node.size) line += ` ${node.size.width}×${node.size.height}`;
    if (node.opacity !== undefined) line += ` opacity:${node.opacity}`;

    if (node.fills) {
      const fillDesc = node.fills.map(f => {
        if (f.type === 'solid') return `bg:${f.color}`;
        if (f.type === 'gradient') return `bg:${f.css}`;
        if (f.type === 'image') return `bg:image(${f.scaleMode})`;
        return null;
      }).filter(Boolean).join(' + ');
      if (fillDesc) line += ` [${fillDesc}]`;
    }

    if (node.strokes) {
      const strokeDesc = node.strokes.map(s => `border:${s.weight}px ${s.color}`).join(', ');
      if (strokeDesc) line += ` [${strokeDesc}]`;
    }

    if (node.borderRadius) {
      if (typeof node.borderRadius === 'number') {
        line += ` radius:${node.borderRadius}px`;
      } else {
        line += ` radius:${node.borderRadius.topLeft}/${node.borderRadius.topRight}/${node.borderRadius.bottomRight}/${node.borderRadius.bottomLeft}px`;
      }
    }

    if (node.layout?.direction) {
      let layoutStr = `${node.layout.direction}`;
      if (node.layout.gap) layoutStr += ` gap:${node.layout.gap}`;
      if (node.layout.wrap) layoutStr += ' wrap';
      const p = node.layout.padding;
      if (p && (p.top || p.right || p.bottom || p.left)) {
        layoutStr += ` pad:${p.top}/${p.right}/${p.bottom}/${p.left}`;
      }
      if (node.layout.justify) layoutStr += ` justify:${node.layout.justify}`;
      if (node.layout.align) layoutStr += ` align:${node.layout.align}`;
      line += ` {${layoutStr}}`;
    }

    if (node.clip) line += ' [clip]';
    if (node.hasImage) line += ' [IMAGE]';
    if (node.isVector) line += ' [VECTOR/ICON]';

    if (node.text) {
      const preview = node.text.length > 120 ? node.text.slice(0, 120) + '…' : node.text;
      const fontStr = node.font ? ` [${node.font.family} ${node.font.weight} ${node.font.size}px` +
        (node.font.align ? ` ${node.font.align}` : '') +
        (node.font.decoration ? ` ${node.font.decoration}` : '') +
        (node.font.textCase ? ` ${node.font.textCase}` : '') + ']' : '';
      line += `: "${preview}"${fontStr}`;
    }

    lines.push(line);

    if (node.children) {
      for (const child of node.children) describe(child, indent + 1);
    }
  }

  for (const section of sections) describe(section);
  return lines.join('\n');
}
