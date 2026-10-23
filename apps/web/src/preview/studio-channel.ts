import {
  DROP_REASONS,
  envelope,
  nonceOf,
  readMessage,
  reportDrop,
  SCROLLED_PER_SECOND,
  STUDIO_HANDSHAKE,
  TO_FRAME,
  TO_STUDIO,
  type DropReason,
  type ToFramePayload,
  type ToFrameType,
  type ToStudioPayload,
} from './protocol';

// Studio's half of the preview channel (#7, Slice 3): one frame's handshake,
// its port, and what comes over it, with no React and no UI, so Slice 4's
// PreviewSurface wraps it. It takes `hello` only from the frame's own
// contentWindow with the frame's current nonce, and from the frame's origin
// when it has one, answers `connect` with a fresh MessagePort, and reads the
// port with protocol.ts. It never calls /api/studio: nothing the frame
// sends leads to a Studio query or command.
//
// A frame's document can change without Studio: a link the agent follows,
// a reload. Studio can't tell which document a `load` event is for, so
// every load closes the port, and nothing goes out until a hello after it.
// Each document says hello with an id of its own once it has loaded, and
// again on a bounded schedule, since its first hello can come before the
// frame's load event does. A hello from the document holding the open port
// changes nothing; one from another document replaces the port.
//
// A message in another version shows `version_mismatch`, for Studio to
// offer a reload, only when it comes over the port or carries the frame's
// current nonce, and once a load at most, so nothing else in the frame can
// raise it.

/** What the frame tells Studio, as callbacks. */
export interface StudioChannelEvents {
  readonly ready?: (payload: ToStudioPayload<'ready'>) => void;
  /** A frame state, or `version_mismatch` when the frame speaks another version. */
  readonly status?: (payload: ToStudioPayload<'status'>) => void;
  readonly link?: (payload: ToStudioPayload<'link'>) => void;
  readonly rect?: (payload: ToStudioPayload<'rect'>) => void;
  readonly navigated?: (payload: ToStudioPayload<'navigated'>) => void;
  readonly scrolled?: (payload: ToStudioPayload<'scrolled'>) => void;
  /** A handshake opened the channel (true), or a load, a reset, or close() closed it (false). */
  readonly connection?: (connected: boolean) => void;
}

export interface StudioChannelOptions {
  readonly iframe: HTMLIFrameElement;
  /** The frame's channel nonce: its grant's, or the one Studio put in a local frame's fragment. */
  readonly nonce: string;
  readonly on?: StudioChannelEvents;
  /** The clock the `scrolled` rate is kept by, in milliseconds. */
  readonly now?: () => number;
  /**
   * The frame's origin, when it has one: an `owner` frame on the preview
   * origin, with `allow-same-origin` (Slice 4). Studio then takes `hello`
   * only from it and sends `connect` to it alone. Without it the frame's
   * origin is opaque, and `connect` goes to `'*'`.
   */
  readonly frameOrigin?: string;
}

export interface StudioChannel {
  /** Whether a handshake has opened the channel to the frame's current document. */
  readonly connected: boolean;
  /** How many messages this side dropped, by reason. */
  readonly dropped: Readonly<Record<DropReason, number>>;
  /**
   * Sends `payload` to the frame. False when no handshake has opened the
   * channel, so nothing went. Throws for a message the protocol refuses.
   */
  send<K extends ToFrameType>(type: K, payload: ToFramePayload<K>): boolean;
  /**
   * For a load Studio starts with a new nonce, a new grant or a new local
   * shell: closes the channel until the frame says hello with `nonce`.
   */
  reset(nonce: string): void;
  /** Stops listening, and closes the channel. */
  close(): void;
}

/** Opens Studio's side of the channel to `iframe`. Call it before the frame loads. */
export function openStudioChannel(options: StudioChannelOptions): StudioChannel {
  const { iframe, on = {}, now = () => Date.now(), frameOrigin } = options;
  const host = iframe.ownerDocument.defaultView;
  if (!host) throw new Error('The frame is in no window.');
  let nonce = options.nonce;
  let seq = 0;
  let port: MessagePort | null = null;
  /** The id of the document holding the port. */
  let portInstance: string | null = null;
  /** Whether `version_mismatch` went out since the frame's last load. */
  let mismatchShown = false;
  let open = true;
  const scrolledAt: number[] = [];
  const dropped = Object.fromEntries(DROP_REASONS.map((reason) => [reason, 0])) as Record<
    DropReason,
    number
  >;

  /**
   * Drops a message, and counts it. `trusted` says it came from the frame's
   * current document, over the port or with its nonce: only such a message
   * in another version shows `version_mismatch`.
   */
  const drop = (reason: DropReason, type?: string, trusted = false) => {
    dropped[reason] += 1;
    reportDrop({ side: 'studio', reason, ...(type === undefined ? {} : { type }) });
    // The frame speaks another version: Studio shows it once a load, with a
    // reload, and takes nothing.
    if (reason === 'version' && trusted && !mismatchShown) {
      mismatchShown = true;
      on.status?.({ state: 'version_mismatch' });
    }
  };

  const closePort = () => {
    if (!port) return;
    port.onmessage = null;
    port.close();
    port = null;
    portInstance = null;
    on.connection?.(false);
  };

  const connect = (instance: string) => {
    // The document holding the port says hello again on its schedule: it
    // already has its answer.
    if (port && portInstance === instance) return;
    closePort();
    const channel = new MessageChannel();
    port = channel.port1;
    portInstance = instance;
    port.onmessage = (event: MessageEvent) => fromPort(event.data);
    // An opaque frame's origin has no name, so `'*'`: the window and the
    // nonce said which frame this is, and the port goes to it. A frame with
    // an origin gets it only while its document is still on that origin.
    iframe.contentWindow?.postMessage(envelope('connect', {}, ++seq), frameOrigin ?? '*', [
      channel.port2,
    ]);
    on.connection?.(true);
  };

  const fromWindow = (event: MessageEvent) => {
    if (event.source === null || event.source !== iframe.contentWindow) return drop('source');
    if (frameOrigin !== undefined && event.origin !== frameOrigin) return drop('origin');
    const read = readMessage(event.data, STUDIO_HANDSHAKE);
    if (!read.ok) return drop(read.reason, read.type, nonceOf(event.data) === nonce);
    if (read.message.payload.nonce !== nonce) return drop('nonce', 'hello');
    connect(read.message.payload.instance);
  };

  const fromPort = (data: unknown) => {
    const read = readMessage(data, TO_STUDIO);
    if (!read.ok) return drop(read.reason, read.type, true);
    const { message } = read;
    switch (message.type) {
      case 'ready':
        return on.ready?.(message.payload);
      case 'status':
        return on.status?.(message.payload);
      case 'link':
        return on.link?.(message.payload);
      case 'rect':
        return on.rect?.(message.payload);
      case 'navigated':
        return on.navigated?.(message.payload);
      case 'scrolled': {
        const at = now();
        while (scrolledAt.length > 0 && at - scrolledAt[0]! >= 1000) scrolledAt.shift();
        if (scrolledAt.length >= SCROLLED_PER_SECOND) return drop('rate', 'scrolled');
        scrolledAt.push(at);
        return on.scrolled?.(message.payload);
      }
    }
  };

  /** A load, whoever started it: the document holding the port may be gone. */
  const onLoad = () => {
    mismatchShown = false;
    closePort();
  };

  host.addEventListener('message', fromWindow);
  iframe.addEventListener('load', onLoad);

  return {
    get connected() {
      return port !== null;
    },
    dropped,
    send(type, payload) {
      if (!open || !port) return false;
      const message = envelope(type, payload, seq + 1);
      const checked = readMessage(message, TO_FRAME);
      if (!checked.ok) {
        throw new TypeError(
          `The preview protocol refuses this ${type} message (${checked.reason}).`,
        );
      }
      seq += 1;
      port.postMessage(message);
      return true;
    },
    reset(next) {
      nonce = next;
      closePort();
    },
    close() {
      open = false;
      host.removeEventListener('message', fromWindow);
      iframe.removeEventListener('load', onLoad);
      closePort();
    },
  };
}
