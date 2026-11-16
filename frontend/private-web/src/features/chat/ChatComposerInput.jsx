import { useCallback, useLayoutEffect, useRef } from 'react';
import styles from './ChatWorkspace.module.css';

/** Controlled input: only the conversation controller can clear a confirmed draft. */
export default function ChatComposerInput({ value, scope, ...props }) {
  const input = useRef(null);
  const resize = useCallback(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = '44px';
    const border = element.offsetHeight - element.clientHeight;
    const height = Math.min(144, Math.max(44, element.scrollHeight + border));
    element.style.height = height + 'px';
    element.style.overflowY = height >= 144 ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(resize, [resize, value, scope]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return undefined;
    let width = element.getBoundingClientRect().width;
    const onResize = () => {
      const next = element.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    observer?.observe(element);
    window.addEventListener('resize', onResize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', onResize); };
  }, [resize]);
  return <textarea {...props} ref={input} value={value} rows={1} className={styles.composerInput} />;
}
