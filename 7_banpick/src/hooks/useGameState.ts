import useSWR from 'swr'
import { useEffect, useMemo } from 'react'
import Pusher from 'pusher-js'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useGameState() {
  const syncMethod = process.env.NEXT_PUBLIC_SYNC_METHOD || 'POLLING'
  
  const { data, error, mutate } = useSWR('/api/state', fetcher, {
    refreshInterval: syncMethod === 'PUSHER' ? 0 : 1000,
  })

  useEffect(() => {
    if (syncMethod !== 'PUSHER') return

    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER

    if (!pusherKey || !cluster) {
      console.warn('Pusher keys missing, falling back to no-sync/manual-only')
      return
    }

    const pusher = new Pusher(pusherKey, {
      cluster: cluster,
    })

    const channel = pusher.subscribe('banpick-channel')
    channel.bind('state-update', () => {
      mutate()
    })

    return () => {
      pusher.unsubscribe('banpick-channel')
      pusher.disconnect()
    }
  }, [mutate, syncMethod])

  return {
    gameState: data?.gameState,
    teams: data?.teams || [],
    members: data?.members || [],
    isLoading: !error && !data,
    isError: error,
    mutate,
  }
}
