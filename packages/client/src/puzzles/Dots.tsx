/** Progress pips: how much of a code or a sequence is in. */
export function Dots({ total, done }: { total: number; done: number }) {
  return (
    <div className="code-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'dot done' : 'dot'} />
      ))}
    </div>
  );
}
