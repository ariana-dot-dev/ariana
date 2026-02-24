import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface HistoricalDataPoint {
  date: string
  value: number
}

interface MetricConfig {
  key: string
  label: string
  color: string
}

const METRICS: MetricConfig[] = [
  { key: 'totalUsers', label: 'Total Users', color: '#8884d8' },
  { key: 'totalProjects', label: 'Total Projects', color: '#82ca9d' },
  { key: 'totalAgents', label: 'Total Agents', color: '#ffc658' },
  { key: 'totalCommits', label: 'Total Commits', color: '#ff7c7c' },
  { key: 'pushedCommits', label: 'Pushed Commits', color: '#8dd1e1' },
  { key: 'agentsWithPushAndPR', label: 'Agents with Push & PR', color: '#d084d0' },
]

const TIME_RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last year' },
]

export function HistoricalTrends() {
  const { token } = useAuth()
  const [selectedMetric, setSelectedMetric] = useState<string>('totalUsers')
  const [selectedDays, setSelectedDays] = useState<string>('30')
  const [data, setData] = useState<HistoricalDataPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHistoricalData()
  }, [token, selectedMetric, selectedDays])

  const fetchHistoricalData = async () => {
    if (!token) {
      setError('No authentication token')
      return
    }

    try {
      setLoading(true)
      setError(null)

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
      const response = await fetch(
        `${apiUrl}/api/admin/analytics/historical/${selectedMetric}?days=${selectedDays}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      )

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Unauthorized: You do not have admin access')
        }
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      if (result.success) {
        // Transform data for the chart
        const chartData = result.data.map((point: any) => ({
          date: new Date(point.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: result.data.length > 90 ? 'numeric' : undefined
          }),
          value: point.value,
        }))
        setData(chartData)
      } else {
        throw new Error(result.error || 'Failed to fetch historical data')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setData([])
    } finally {
      setLoading(false)
    }
  }

  const currentMetric = METRICS.find(m => m.key === selectedMetric)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historical Trends</CardTitle>
        <CardDescription>
          Track metrics over time to see growth and patterns
        </CardDescription>
        <div className="flex gap-4 mt-4">
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Metric</label>
            <Select value={selectedMetric} onValueChange={setSelectedMetric}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map(metric => (
                  <SelectItem key={metric.key} value={metric.key}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Time Range</label>
            <Select value={selectedDays} onValueChange={setSelectedDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGES.map(range => (
                  <SelectItem key={range.value} value={range.value}>
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-64">
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">No historical data available yet</p>
          </div>
        )}

        {!loading && !error && data.length > 0 && (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12 }}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                name={currentMetric?.label || selectedMetric}
                stroke={currentMetric?.color || '#8884d8'}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
