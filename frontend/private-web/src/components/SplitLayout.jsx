const ASIDE_WIDTHS = {
  sm: 'lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]',
  md: 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] 2xl:grid-cols-[minmax(0,1fr)_26rem]',
  lg: 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] 2xl:grid-cols-[minmax(0,1fr)_32rem]',
  ratio: 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
};

// Contenido principal + panel lateral. En teléfono y tablet vertical se apilan;
// desde `lg` (1024px) el panel queda a la derecha con un ancho acotado.
// `asideFirst` coloca el panel antes del contenido en la vista apilada.
export default function SplitLayout({ main, aside, asideWidth = 'md', asideFirst = false, className = '' }) {
  return (
    <div className={`grid items-start gap-5 ${ASIDE_WIDTHS[asideWidth] ?? ASIDE_WIDTHS.md} ${className}`}>
      <div className={`min-w-0 ${asideFirst ? 'order-2 lg:order-1' : ''}`}>{main}</div>
      <div className={`min-w-0 ${asideFirst ? 'order-1 lg:order-2' : ''}`}>{aside}</div>
    </div>
  );
}
