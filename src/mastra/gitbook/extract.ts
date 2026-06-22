import type { GitBookDocumentNode, GitBookPage, WikiPage } from './types';

export function pageToWikiPage(page: GitBookPage): WikiPage {
  const title = page.title || page.path || page.id;
  const body = documentToText(page.document);
  const text = [`# ${title}`, body].filter(Boolean).join('\n\n').trim();

  return {
    id: page.id,
    title,
    path: page.path || page.slug || page.id,
    url: page.urls?.app,
    updatedAt: page.updatedAt,
    text,
  };
}

export function documentToText(node: GitBookDocumentNode | undefined): string {
  return normalizeText(renderNode(node, { depth: 0, ordered: false, index: 1 }));
}

interface RenderContext {
  depth: number;
  ordered: boolean;
  index: number;
}

function renderNode(node: GitBookDocumentNode | undefined, context: RenderContext): string {
  if (!node) return '';

  if (typeof node.text === 'string') {
    return node.text;
  }

  const type = String(node.type || node.object || '');
  const children = renderChildren(node, context);

  switch (type) {
    case 'document':
    case 'fragment':
      return children.join('\n\n');
    case 'paragraph':
      return children.join('');
    case 'heading-1':
      return `# ${children.join('')}`;
    case 'heading-2':
      return `## ${children.join('')}`;
    case 'heading-3':
      return `### ${children.join('')}`;
    case 'heading-4':
      return `#### ${children.join('')}`;
    case 'heading-5':
      return `##### ${children.join('')}`;
    case 'heading-6':
      return `###### ${children.join('')}`;
    case 'list-unordered':
      return renderList(node, false, context.depth);
    case 'list-ordered':
      return renderList(node, true, context.depth);
    case 'list-item':
      return children.join(' ').replace(/\s+/g, ' ').trim();
    case 'blockquote':
      return children
        .join('\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'code':
      return renderCodeBlock(node, children.join('\n'));
    case 'table':
      return children.join('\n');
    case 'table-row':
      return `| ${children.map((cell) => cell.replace(/\n/g, ' ').trim()).join(' | ')} |`;
    case 'table-cell':
      return children.join(' ');
    case 'link':
      return renderLink(node, children.join(''));
    case 'image':
    case 'images':
      return renderImage(node, children.join(''));
    case 'hint':
      return children.join('\n');
    case 'grid':
      return children.join('\n\n');
    case 'text':
    case 'leaf':
      return children.join('');
    default:
      return children.join(type.includes('heading') ? '' : '\n');
  }
}

function renderChildren(node: GitBookDocumentNode, context: RenderContext): string[] {
  const children: string[] = [];

  for (const key of ['leaves', 'nodes'] as const) {
    const value = node[key];
    if (!Array.isArray(value)) continue;

    for (const child of value) {
      children.push(renderNode(child as GitBookDocumentNode, context));
    }
  }

  return children.filter(Boolean);
}

function renderList(node: GitBookDocumentNode, ordered: boolean, depth: number) {
  const items = Array.isArray(node.nodes) ? node.nodes : [];

  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : '-';
      const indent = '  '.repeat(depth);
      const text = renderNode(item as GitBookDocumentNode, { depth: depth + 1, ordered, index: index + 1 });
      return `${indent}${marker} ${text}`;
    })
    .join('\n');
}

function renderCodeBlock(node: GitBookDocumentNode, fallback: string) {
  const syntax = typeof node.data?.syntax === 'string' ? node.data.syntax : '';
  const code = typeof node.data?.code === 'string' ? node.data.code : fallback;
  return `\`\`\`${syntax}\n${code.trim()}\n\`\`\``;
}

function renderLink(node: GitBookDocumentNode, label: string) {
  const url = typeof node.data?.url === 'string' ? node.data.url : undefined;
  if (!url) return label;

  return label ? `${label} (${url})` : url;
}

function renderImage(node: GitBookDocumentNode, label: string) {
  const alt = typeof node.data?.alt === 'string' ? node.data.alt : label;
  const ref = typeof node.data?.ref === 'string' ? node.data.ref : undefined;
  return [alt || 'Image', ref].filter(Boolean).join(' ');
}

function normalizeText(text: string) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
