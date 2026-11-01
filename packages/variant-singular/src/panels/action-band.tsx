import type { VariantRenderInput } from '@portfolio/variant-contract';
import { actionOf, outbound, pad2, planOf, type Panel, type PanelAction } from '../model';
import { Arrow, Hidden, hrefOf, uiLang, Words } from '../parts';

// The action band (brief §5.7; SG-M2, SG-M3): the bottom of every panel is
// one full-width band on the other of paper and ink, so the alternation
// shows at 240 px. It holds the counter, the one action, and where the
// action leads. The action is a real link whose box covers the whole band
// (the report's 64 px Fitts bar), so the counter sits inside the target
// without being read as part of the link's name; on a phone the counter
// takes its own line and the action stacks full width at 44 px or more.
// It's the panel's footer: inside the section it's no landmark, only the
// end of that panel, with its place in the sequence and the way on.

export function ActionBand({ input, panel }: { input: VariantRenderInput; panel: Panel }) {
  return (
    <Band
      input={input}
      n={panel.n}
      total={planOf(input).panels.length}
      ground={panel.band}
      finale={panel.key === 'contact'}
      action={actionOf(input, panel)}
    />
  );
}

/** A band from its parts: the home's panels and the case page's stops both end on one. */
export function Band({
  input,
  n,
  total,
  ground,
  finale,
  action,
}: {
  input: VariantRenderInput;
  n: number;
  total: number;
  ground: 'canvas' | 'inverse';
  finale: boolean;
  action: PanelAction | undefined;
}) {
  const lang = uiLang(input.portfolio.locale);
  const href = action ? hrefOf(action.target, input) : undefined;
  return (
    <footer
      className="sg-band"
      data-ground={ground}
      data-ui-surface={ground === 'inverse' ? 'inverse' : undefined}
      data-sg-band={finale ? 'finale' : undefined}
      data-sg-rise="act"
    >
      <div className="sg-grid sg-band__in">
        <p className="sg-band__count sg-num" data-type-role="numeric">
          <span aria-hidden="true">
            {pad2(n)} / {pad2(total)}
          </span>
          <Hidden lang={lang}>{`Panel ${n} of ${total}`}</Hidden>
        </p>
        {action ? (
          <a className="sg-band__go" href={href} data-dir={action.dir} data-sg-go="">
            <span className="sg-band__label" data-type-role="title">
              {action.own ? action.label : <Words lang={lang}>{action.label}</Words>}
              {action.object ? <> {action.object}</> : null}
            </span>
            <span className="sg-band__dest" data-type-role="body">
              {action.dest ? (
                <span className="sg-band__where">
                  {action.dest.own ? (
                    action.dest.text
                  ) : (
                    <Words lang={lang}>{action.dest.text}</Words>
                  )}
                </span>
              ) : null}
              <Arrow dir={action.dir} />
            </span>
            {href && outbound(href) ? <Hidden lang={lang}>(opens another site)</Hidden> : null}
          </a>
        ) : null}
      </div>
    </footer>
  );
}
