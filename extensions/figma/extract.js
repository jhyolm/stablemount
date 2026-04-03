// Extracts design tokens and structural descriptions from Figma API data.

export function extractTokens(figmaData) {
  const tokens = { colors: [], fonts: [], effects: [], spacing: [] };

  const colorMap = new Map();
  const fontMap = new Map();

  function walkNode(node) {
    // Colors from fills
    if (node.fills && Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.type === 'SOLID' && fill.color) {
          const { r, g, b } = fill.color;
          const a = fill.opacity ?? fill.color.a ?? 1;
          const hex = rgbToHex(r, g, b);
          const key = a < 1 ? `rgba(${hex},${a.toFixed(2)})` : hex;
          if (!colorMap.has(key)) {
            colorMap.set(key, { value: a < 1 ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a.toFixed(2)})` : hex, source: node.name });
          }
        }
      }
    }

    // Typography from text nodes
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
          source: node.name,
        });
      }
    }

    // Effects (shadows, blurs)
    if (node.effects && Array.isArray(node.effects)) {
      for (const effect of node.effects) {
        if (effect.visible === false) continue;
        if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
          const { r, g, b, a } = effect.color || {};
          tokens.effects.push({
            type: effect.type.toLowerCase().replace('_', '-'),
            offset: { x: effect.offset?.x || 0, y: effect.offset?.y || 0 },
            radius: effect.radius || 0,
            color: r !== undefined ? `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${(a||1).toFixed(2)})` : null,
            source: node.name,
          });
        }
      }
    }

    // Recurse children
    if (node.children) {
      for (const child of node.children) walkNode(child);
    }
  }

  if (figmaData.document) walkNode(figmaData.document);

  tokens.colors = [...colorMap.values()];
  tokens.fonts = [...fontMap.values()];

  return tokens;
}

export function extractStructure(figmaData, nodeId) {
  const target = nodeId ? findNode(figmaData.document, nodeId) : figmaData.document;
  if (!target) return [];

  const sections = [];

  function describeNode(node, depth = 0) {
    if (depth > 6) return null;

    const desc = {
      name: node.name,
      type: node.type,
    };

    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      desc.layout = describeLayout(node);
      desc.size = node.absoluteBoundingBox ? {
        width: Math.round(node.absoluteBoundingBox.width),
        height: Math.round(node.absoluteBoundingBox.height),
      } : null;
    }

    if (node.type === 'TEXT') {
      desc.text = node.characters || '';
      if (node.style) {
        desc.font = `${node.style.fontFamily} ${node.style.fontWeight} ${node.style.fontSize}px`;
      }
    }

    if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      desc.isComponent = true;
      desc.componentName = node.name;
    }

    if (node.children && node.children.length) {
      desc.children = node.children
        .map(c => describeNode(c, depth + 1))
        .filter(Boolean);
    }

    return desc;
  }

  const topFrames = target.children || [target];
  for (const frame of topFrames) {
    if (frame.type === 'FRAME' || frame.type === 'COMPONENT' || frame.type === 'SECTION') {
      sections.push(describeNode(frame));
    }
  }

  return sections;
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
  }
  if (node.cornerRadius) layout.borderRadius = node.cornerRadius;
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
        content: `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.color}`,
        weight: 'guide',
        scope: 'global',
      });
    }
  }

  return decisions;
}

export function structureToDescription(sections) {
  const lines = [];

  function describe(node, indent = 0) {
    const pad = '  '.repeat(indent);
    let line = `${pad}- ${node.name} (${node.type})`;

    if (node.isComponent) line += ' [COMPONENT]';
    if (node.text) line += `: "${node.text.slice(0, 80)}${node.text.length > 80 ? '...' : ''}"`;
    if (node.layout?.direction) line += ` [${node.layout.direction}, gap:${node.layout.gap}px]`;
    if (node.size) line += ` ${node.size.width}x${node.size.height}`;

    lines.push(line);

    if (node.children) {
      for (const child of node.children) describe(child, indent + 1);
    }
  }

  for (const section of sections) describe(section);
  return lines.join('\n');
}
