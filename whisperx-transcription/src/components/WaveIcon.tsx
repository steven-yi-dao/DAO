import './WaveIcon.css';

/** Decorative waveform mark shown in cloud-queue headers. */
export function WaveIcon() {
  return (
    <span className="wave-icon" aria-hidden="true">
      <span className="wave-icon__bar" />
      <span className="wave-icon__dot wave-icon__dot--1" />
      <span className="wave-icon__dot wave-icon__dot--2" />
      <span className="wave-icon__dot wave-icon__dot--3" />
    </span>
  );
}
