// Icône de Lector : livre ouvert au trait miel sur encre sapin, à plat,
// carré très arrondi (rayon 30 %). Même dessin que l'icône des apps.
export default function AppMark({ size = 56, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7.2" fill="#1F2A22" />
      <g transform="translate(12 12) scale(0.68) translate(-12 -12)" fill="none" stroke="#E9A23B" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6.5A2 2 0 0 1 6 4.5h5v15H6a2 2 0 0 1-2-2z" />
        <path d="M20 6.5a2 2 0 0 0-2-2h-5v15h5a2 2 0 0 0 2-2z" />
      </g>
    </svg>
  )
}
