export function WatchQueueVisualFilters() {
  return (
    <svg
      className="watch-queue-visual-filters"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id="watch-queue-newsprint-portrait"
          x="-12%"
          y="-12%"
          width="124%"
          height="124%"
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="
              0.299 0.587 0.114 0 0
              0.299 0.587 0.114 0 0
              0.299 0.587 0.114 0 0
              0     0     0     1 0
            "
            result="monochrome"
          />
          <feComponentTransfer in="monochrome" result="inked">
            <feFuncR type="linear" slope="1.14" intercept="-0.07" />
            <feFuncG type="linear" slope="1.14" intercept="-0.07" />
            <feFuncB type="linear" slope="1.14" intercept="-0.07" />
            <feFuncA type="identity" />
          </feComponentTransfer>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.72"
            numOctaves="1"
            seed="22"
            result="pressGrain"
          />
          <feColorMatrix
            in="pressGrain"
            type="matrix"
            values="
              0.82 0    0    0 0
              0    0.82 0    0 0
              0    0    0.82 0 0
              0    0    0    0.16 0
            "
            result="screenGrain"
          />
          <feBlend in="inked" in2="screenGrain" mode="multiply" />
        </filter>
      </defs>
    </svg>
  );
}
