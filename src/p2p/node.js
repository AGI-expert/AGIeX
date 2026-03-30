/**
 * P2P Node — libp2p networking with GossipSub.
 *
 * Creates a libp2p node that:
 * - Listens on TCP + WebSocket
 * - Connects to bootstrap peers
 * - Discovers local peers via mDNS
 * - Publishes/subscribes to GossipSub topics
 * - Supports circuit relay for NAT traversal
 */

import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { bootstrap } from "@libp2p/bootstrap";
import { mdns } from "@libp2p/mdns";
import { identify } from "@libp2p/identify";
import { kadDHT } from "@libp2p/kad-dht";
import { circuitRelayTransport, circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";

// GossipSub topic names — one per research domain + system channels
export const TOPICS = {
  RESEARCH_ROUNDS: "agi/research/rounds",
  SEARCH_EXPERIMENTS: "agi/search/experiments",
  FINANCE_EXPERIMENTS: "agi/finance/experiments",
  CODING_EXPERIMENTS: "agi/coding/experiments",
  SKILLS: "agi/cause/skills",
  INSPIRATION: "agi/cause/inspiration",
  PULSE: "agi/pulse",
  LEADERBOARD_SYNC: "agi/leaderboard/sync",
  PEER_ANNOUNCE: "agi/peers/announce",
  GOVERNANCE: "agi/governance",
};

/**
 * Create and start a libp2p P2P node.
 *
 * @param {object} opts
 * @param {string[]} opts.bootstrapList - Multiaddrs of bootstrap nodes
 * @param {string[]} opts.listenAddrs  - Addresses to listen on
 * @param {boolean}  opts.isRelay      - Whether to act as a circuit relay
 * @param {object}   opts.logger       - Logger instance
 * @returns {Promise<object>} The libp2p node
 */
export async function createP2PNode(opts = {}) {
  const {
    bootstrapList = [],
    listenAddrs = ["/ip4/0.0.0.0/tcp/4001", "/ip4/0.0.0.0/tcp/4002/ws"],
    isRelay = false,
    logger = console,
  } = opts;

  const peerDiscovery = [mdns()];
  if (bootstrapList.length > 0) {
    peerDiscovery.push(bootstrap({ list: bootstrapList }));
  }

  const transports = [tcp(), webSockets()];
  if (!isRelay) {
    transports.push(circuitRelayTransport());
  }

  const services = {
    identify: identify(),
    pubsub: gossipsub({
      emitSelf: false,
      allowPublishToZeroTopicPeers: true,
      gossipIncoming: true,
      fallbackToFloodsub: true,
      floodPublish: true,
      doPX: true,
    }),
    dht: kadDHT({ clientMode: false }),
    dcutr: dcutr(),
  };

  if (isRelay) {
    services.relay = circuitRelayServer();
  }

  const node = await createLibp2p({
    addresses: { listen: listenAddrs },
    transports,
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    peerDiscovery,
    services,
  });

  // Log peer events
  node.addEventListener("peer:connect", (evt) => {
    logger.log(`[p2p] Connected to ${evt.detail.toString()}`);
  });
  node.addEventListener("peer:disconnect", (evt) => {
    logger.log(`[p2p] Disconnected from ${evt.detail.toString()}`);
  });

  await node.start();
  const addrs = node.getMultiaddrs().map((ma) => ma.toString());
  logger.log(`[p2p] Node started. PeerId: ${node.peerId.toString()}`);
  logger.log(`[p2p] Listening on:`, addrs);

  return node;
}

/**
 * Subscribe to all network GossipSub topics.
 */
export function subscribeAll(node, handler) {
  const pubsub = node.services.pubsub;
  for (const topic of Object.values(TOPICS)) {
    pubsub.subscribe(topic);
    pubsub.addEventListener("message", (evt) => {
      if (evt.detail.topic === topic) {
        try {
          const data = JSON.parse(new TextDecoder().decode(evt.detail.data));
          handler(topic, data, evt.detail.from?.toString());
        } catch {
          // non-JSON message, ignore
        }
      }
    });
  }
}

/**
 * Publish a message to a GossipSub topic.
 */
export async function publish(node, topic, data) {
  const pubsub = node.services.pubsub;
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  await pubsub.publish(topic, encoded);
}

/**
 * Get the list of connected peers.
 */
export function getConnectedPeers(node) {
  return node.getConnections().map((conn) => ({
    peerId: conn.remotePeer.toString(),
    addr: conn.remoteAddr.toString(),
    direction: conn.direction,
  }));
}
