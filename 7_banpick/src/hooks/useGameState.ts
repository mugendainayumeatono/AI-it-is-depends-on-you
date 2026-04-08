import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useGameState() {
  const { data, error, mutate } = useSWR('/api/state', fetcher, {
    refreshInterval: 1000, // Poll every second
  })

  return {
    gameState: data?.gameState,
    teams: data?.teams || [],
    members: data?.members || [],
    isLoading: !error && !data,
    isError: error,
    mutate,
  }
}
