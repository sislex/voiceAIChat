import { ACCENT } from '../lib/view'

/** Анимированная волна из 28 столбиков (режим записи). */
export function WaveBars(): JSX.Element {
  return (
    <>
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="wbar"
          style={{
            background: ACCENT,
            height: 14 + Math.abs(Math.sin(i * 1.7)) * 30 + 'px',
            animationDelay: i * 0.055 + 's'
          }}
        />
      ))}
    </>
  )
}

/** Мини-эквалайзер из 5 столбиков (режим озвучки). */
export function EqBars(): JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="eqb"
          style={{ background: ACCENT, height: 8 + (i % 3) * 6 + 'px', animationDelay: i * 0.12 + 's' }}
        />
      ))}
    </>
  )
}

/** Три прыгающие точки. */
export function Dots(): JSX.Element {
  return (
    <div className="dots">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  )
}
