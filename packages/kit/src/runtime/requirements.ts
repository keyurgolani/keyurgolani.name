// An enhancement's `requires` (#5's manifest contract), checked at run time
// in the browser that loads it (#6, items 6 and 7): capability checks only,
// never a user agent list. A requirement this build doesn't know fails, so a
// newer contract's requirement never loads an enhancement here by mistake.

/** What the checks ask of the browser: injectable, so tests give their own. */
export interface CapabilityProbe {
  /** Whether a canvas can get a WebGL2 context. */
  readonly webgl2: () => boolean;
  /** Whether a media query matches. */
  readonly matches: (query: string) => boolean;
}

const MIN_WIDTH = /^min-width:([1-9][0-9]{0,4})$/;

/** Whether one requirement holds, given the probe and whether motion is allowed. */
export function meetsRequirement(
  requirement: string,
  probe: CapabilityProbe,
  motionAllowed: boolean,
): boolean {
  if (requirement === 'webgl2') return probe.webgl2();
  if (requirement === 'fine-pointer') return probe.matches('(pointer: fine)');
  if (requirement === 'motion-allowed') return motionAllowed;
  const width = MIN_WIDTH.exec(requirement);
  if (width) return probe.matches(`(min-width: ${width[1]}px)`);
  return false;
}

/** Whether every requirement holds: an empty list always does. */
export function meetsRequirements(
  requires: readonly string[],
  probe: CapabilityProbe,
  motionAllowed: boolean,
): boolean {
  return requires.every((requirement) => meetsRequirement(requirement, probe, motionAllowed));
}

let webgl2: boolean | undefined;

/** The browser's own probe: one WebGL2 check per page, kept, and live media queries. */
export function browserProbe(): CapabilityProbe {
  return {
    webgl2: () => {
      if (webgl2 === undefined) {
        try {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('webgl2');
          webgl2 = context !== null;
          context?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
          webgl2 = false;
        }
      }
      return webgl2;
    },
    matches: (query) => typeof matchMedia === 'function' && matchMedia(query).matches,
  };
}
