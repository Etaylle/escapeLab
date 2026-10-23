import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** An element of a rendered tree, its props as they were given. */
export type Rendered = ReactElement<Record<string, unknown>>;

/** Every element `node` comes to, function components called through. */
function expand(node: ReactNode): Rendered[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: ReactNode) => expand(child));
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return [];
  }
  if (typeof node.type === 'function') {
    return expand((node.type as (props: unknown) => ReactNode)(node.props));
  }
  return [node, ...expand(node.props['children'] as ReactNode)];
}

/**
 * Every element what `render` returns comes to, its function components called through
 * inside a render of their own — so that their hooks run, and read the contexts `wrap` puts
 * round it — for a test to find a control and press it (`props.onClick`) without a DOM.
 */
export function elementsOf(
  render: () => ReactNode,
  wrap: (probe: ReactNode) => ReactNode = (probe) => probe,
): Rendered[] {
  let found: Rendered[] = [];
  function Probe() {
    found = expand(render());
    return null;
  }
  renderToStaticMarkup(<>{wrap(<Probe />)}</>);
  return found;
}

/** The buttons among `elements` whose class names include `name`. */
export function buttonsOf(elements: readonly Rendered[], name: string): Rendered[] {
  return elements.filter(
    (element) =>
      element.type === 'button' &&
      String(element.props['className'] ?? '')
        .split(' ')
        .includes(name),
  );
}

/** Presses a button found by `buttonsOf`. */
export function press(button: Rendered | undefined): void {
  if (button === undefined) {
    throw new Error('no such button to press');
  }
  (button.props['onClick'] as () => void)();
}
