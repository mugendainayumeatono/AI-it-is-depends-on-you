import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'
import Pusher from 'pusher-js'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useGameState() {
  const syncMethod = process.env.NEXT_PUBLIC_SYNC_METHOD || 'POLLING'
  const [serverOffset, setServerOffset] = useState(0)
  
  const { data, error, mutate } = useSWR('/api/state', fetcher, {
    refreshInterval: syncMethod === 'PUSHER' ? 0 : 1000,
  })

  // Update serverOffset whenever data with serverTime is received
  useEffect(() => {
    if (data?.serverTime) {
      const serverDate = new Date(data.serverTime).getTime()
      const localDate = Date.now()
      // We only update if it's a fresh update to avoid jitter from re-renders
      // But SWR data is stable if not changed, so this is fine.
      setServerOffset(serverDate - localDate)
    }
  }, [data?.serverTime])

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
    channel.bind('state-update', (payload: any) => {
      if (payload && payload.state) {
        mutate(payload.state, { revalidate: false })
      } else {
        mutate()
      }
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
    serverOffset,
    isLoading: !error && !data,
    isError: error,
    mutate,
  }
}
