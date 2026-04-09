import PusherServer from 'pusher'

const getPusherServer = () => {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    return null;
  }

  return new PusherServer({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
};

export const pusherServer = getPusherServer();

export const triggerStateUpdate = async () => {
  const method = process.env.NEXT_PUBLIC_SYNC_METHOD || 'POLLING';
  if (method !== 'PUSHER' || !pusherServer) return;

  try {
    await pusherServer.trigger('banpick-channel', 'state-update', {
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Pusher trigger error:', error);
  }
};
