import {
  DROP_REASONS,
  envelope,
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
// contentWindow with the frame's current nonce, answers `connect` with a
// fresh MessagePort, and reads the port with protocol.ts. It never calls
// /api/studio: nothing the frame sends leads to a Studio query or command.
//
// A frame's document can change without Studio: a link the agent follows,
// a reload. Each document says hello with an id of its own once it has
// loaded, and the frame's `load` event comes before or after that hello, so
// the channel goes by the id. A load whose document isn't the one holding
// the port closes it, and nothing goes out until that document's hello.

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
  const { iframe, on = {}, now = () => Date.now() } = options;
  const host = iframe.ownerDocument.defaultView;
  if (!host) throw new Error('The frame is in no window.');
  let nonce = options.nonce;
  let seq = 0;
  let port: MessagePort | null = null;
  /** The id of the document holding the port. */
  let portInstance: string | null = null;
  /** The id of the document the last `load` was for, once it said hello. */
  let loadInstance: string | null = null;
  /** A `load` came whose document hasn't said hello yet. */
  let loadPending = false;
  let open = true;
  const scrolledAt: number[] = [];
  const dropped = Object.fromEntries(DROP_REASONS.map((reason) => [reason, 0])) as Record<
    DropReason,
    number
  >;

  const drop = (reason: DropReason, type?: string) => {
    dropped[reason] += 1;
    reportDrop({ side: 'studio', reason, ...(type === undefined ? {} : { type }) });
    // The frame speaks another version: Studio shows it, with a reload, and takes nothing.
    if (reason === 'version') on.status?.({ state: 'version_mismatch' });
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
    closePort();
    const channel = new MessageChannel();
    port = channel.port1;
    portInstance = instance;
    if (loadPending) {
      loadInstance = instance;
      loadPending = false;
    }
    port.onmessage = (event: MessageEvent) => fromPort(event.data);
    // The frame's origin is opaque, so no target origin names it: the window
    // and the nonce said which frame this is, and the port goes to it.
    iframe.contentWindow?.postMessage(envelope('connect', {}, ++seq), '*', [channel.port2]);
    on.connection?.(true);
  };

  const fromWindow = (event: MessageEvent) => {
    if (event.source === null || event.source !== iframe.contentWindow) return drop('source');
    const read = readMessage(event.data, STUDIO_HANDSHAKE);
    if (!read.ok) return drop(read.reason, read.type);
    if (read.message.payload.nonce !== nonce) return drop('nonce', 'hello');
    connect(read.message.payload.instance);
  };

  const fromPort = (data: unknown) => {
    const read = readMessage(data, TO_STUDIO);
    if (!read.ok) return drop(read.reason, read.type);
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

  const onLoad = () => {
    if (!port) {
      loadPending = true;
    } else if (loadInstance !== null && portInstance === loadInstance) {
      // The port is the last load's document's: this load replaced it.
      closePort();
      loadPending = true;
    } else {
      // Its document said hello before its own load event got here.
      loadInstance = portInstance;
      loadPending = false;
    }
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
