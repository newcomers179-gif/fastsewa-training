/** Renders lesson Markdown (the shared dialect) as React elements. Nothing here sets innerHTML. */
import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@shared/markdown";

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>;
      case "bold":
        return <strong key={i}>{inline(node.children)}</strong>;
      case "italic":
        return <em key={i}>{inline(node.children)}</em>;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(node.children)}
          </a>
        );
    }
  });
}

function block(node: Block, index: number): ReactNode {
  switch (node.type) {
    case "heading":
      return node.level === 1 ? <h1 key={index}>{inline(node.children)}</h1> : node.level === 2 ? <h2 key={index}>{inline(node.children)}</h2> : <h3 key={index}>{inline(node.children)}</h3>;
    case "paragraph":
      return <p key={index}>{inline(node.children)}</p>;
    case "quote":
      return <blockquote key={index}>{inline(node.children)}</blockquote>;
    case "rule":
      return <hr key={index} className="divider" />;
    case "list": {
      const items = node.items.map((item, i) => <li key={i}>{inline(item)}</li>);
      return node.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
  }
}

export function Markdown({ source, lang }: { source: string; lang?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="md-preview" lang={lang}>
      {blocks.length === 0 ? <p className="muted">Nothing to preview yet.</p> : blocks.map(block)}
    </div>
  );
}
