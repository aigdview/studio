import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export const ListeningIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
    <path d="M16 12a4 4 0 0 0-8 0">
       <animateTransform
        attributeName="transform"
        type="scale"
        values="1; 1.2; 1"
        dur="1.5s"
        repeatCount="indefinite"
        begin="0s" />
    </path>
  </svg>
);

export const SpeakingIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="currentColor"
    strokeWidth="0"
  >
    <g>
      <path d="M12 2C10.9 2 10 2.9 10 4v8c0 1.1.9 2 2 2s2-.9 2-2V4c0-1.1-.9-2-2-2z">
        <animate
            attributeName="opacity"
            values="1; .5; 1"
            dur="1s"
            repeatCount="indefinite" />
      </path>
      <path d="M17 10h-1c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V20h2v-3.08c3.39-.49 6-3.39 6-6.92z" />
    </g>
  </svg>
);


export const ThinkingIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <circle cx="4" cy="12" r="3">
      <animate
        id="a"
        begin="0;c.end-0.25s"
        attributeName="r"
        dur="0.75s"
        values="3;3;0;3"
      />
    </circle>
    <circle cx="12" cy="12" r="3">
      <animate
        id="b"
        begin="a.end-0.6s"
        attributeName="r"
        dur="0.75s"
        values="3;3;0;3"
      />
    </circle>
    <circle cx="20" cy="12" r="3">
      <animate
        id="c"
        begin="b.end-0.5s"
        attributeName="r"
        dur="0.75s"
        values="3;3;0;3"
      />
    </circle>
  </svg>
);
