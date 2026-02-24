import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

type CohortPeriod = 'daily' | 'weekly' | 'biweekly'

interface ActivationRateData {
  cohortLabel: string
  userCount: number
  activatedDay1: number
  activatedDay3: number
  activatedDay7: number
  activationRateDay1: number
  activationRateDay3: number
  activationRateDay7: number
}

interface EngagementProgressionData {
  cohortLabel: string
  dayNumber: number
  avgAgents: number
  avgPrompts: number
  avgPushedCommits: number
}

interface TimeToFirstActionData {
  cohortLabel: string
  medianTimeToFirstAgent: number | null
  medianTimeToFirstPrompt: number | null
  medianTimeToFirstPush: number | null
  p75TimeToFirstAgent: number | null
  p75TimeToFirstPrompt: number | null
  p75TimeToFirstPush: number | null
}

interface RetentionByWeekData {
  cohortLabel: string
  userCount: number
  retainedWeek2: number
  retentionRateWeek2: number
  retainedWeek3: number
  retentionRateWeek3: number
}

interface SuccessRateByCohortData {
  cohortLabel: string
  totalAgents: number
  agentsWithPush: number
  agentsWithPR: number
  pushRate: number
  prRate: number
}

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
]

interface CohortAnalysisProps {
  excludeUsers?: string
}

export function CohortAnalysis({ excludeUsers = '' }: CohortAnalysisProps) {
  const { token } = useAuth()
  const [period, setPeriod] = useState<CohortPeriod>('weekly')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activationData, setActivationData] = useState<ActivationRateData[]>([])
  const [engagementData, setEngagementData] = useState<EngagementProgressionData[]>([])
  const [timeToActionData, setTimeToActionData] = useState<TimeToFirstActionData[]>([])
  const [retentionData, setRetentionData] = useState<RetentionByWeekData[]>([])
  const [successData, setSuccessData] = useState<SuccessRateByCohortData[]>([])

  useEffect(() => {
    fetchAllCohortData()
  }, [token, period, excludeUsers])

  const fetchAllCohortData = async () => {
    if (!token) return

    setLoading(true)
    setError(null)

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
      const headers = { 'Authorization': `Bearer ${token}` }
      const excludeParam = excludeUsers ? `&excludeUsers=${encodeURIComponent(excludeUsers)}` : ''

      const [activationRes, engagementRes, timeToActionRes, retentionRes, successRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/analytics/cohorts/activation?period=${period}${excludeParam}`, { headers }),
        fetch(`${apiUrl}/api/admin/analytics/cohorts/engagement?period=${period}${excludeParam}`, { headers }),
        fetch(`${apiUrl}/api/admin/analytics/cohorts/time-to-action?period=${period}${excludeParam}`, { headers }),
        fetch(`${apiUrl}/api/admin/analytics/cohorts/retention?period=${period}${excludeParam}`, { headers }),
        fetch(`${apiUrl}/api/admin/analytics/cohorts/success?period=${period}${excludeParam}`, { headers }),
      ])

      if (activationRes.ok) {
        const data = await activationRes.json()
        if (data.success) setActivationData(data.data)
      }

      if (engagementRes.ok) {
        const data = await engagementRes.json()
        if (data.success) setEngagementData(data.data)
      }

      if (timeToActionRes.ok) {
        const data = await timeToActionRes.json()
        if (data.success) setTimeToActionData(data.data)
      }

      if (retentionRes.ok) {
        const data = await retentionRes.json()
        if (data.success) setRetentionData(data.data)
      }

      if (successRes.ok) {
        const data = await successRes.json()
        if (data.success) setSuccessData(data.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cohort data')
    } finally {
      setLoading(false)
    }
  }

  // Process engagement data for multi-line chart (group by cohort, X-axis = day number)
  const processEngagementForChart = () => {
    // Get unique cohorts (latest 4)
    const cohorts = [...new Set(engagementData.map(d => d.cohortLabel))].slice(-4)

    // Group by day number
    const byDay: Record<number, Record<string, number>> = {}
    for (const d of engagementData) {
      if (!cohorts.includes(d.cohortLabel)) continue
      if (!byDay[d.dayNumber]) byDay[d.dayNumber] = {}
      byDay[d.dayNumber][d.cohortLabel] = d.avgAgents
    }

    return Object.entries(byDay)
      .map(([day, cohortData]) => ({
        day: parseInt(day),
        ...cohortData
      }))
      .sort((a, b) => a.day - b.day)
  }

  const engagementChartData = processEngagementForChart()
  const engagementCohorts = [...new Set(engagementData.map(d => d.cohortLabel))].slice(-4)
  const cohortColors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c']

  const formatHours = (hours: number | null) => {
    if (hours === null) return 'N/A'
    if (hours < 1) return `${Math.round(hours * 60)}m`
    if (hours < 24) return `${hours.toFixed(1)}h`
    return `${(hours / 24).toFixed(1)}d`
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cohort Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading cohort data...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cohort Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-red-500">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cohort Analysis</CardTitle>
              <CardDescription>
                Compare metrics across signup cohorts to detect improvements
              </CardDescription>
            </div>
            <div className="w-48">
              <Select value={period} onValueChange={(v) => setPeriod(v as CohortPeriod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Activation Rates by Cohort */}
      <Card>
        <CardHeader>
          <CardTitle>Activation Rates by Signup Cohort</CardTitle>
          <CardDescription>
            % of users who created their first agent within N days of signup
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activationData.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={activationData.slice(-8)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="cohortLabel" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                <Legend />
                <Bar dataKey="activationRateDay1" fill="#8884d8" name="Day 1" />
                <Bar dataKey="activationRateDay3" fill="#82ca9d" name="Day 3" />
                <Bar dataKey="activationRateDay7" fill="#ffc658" name="Day 7" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No activation data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Engagement Progression */}
      <Card>
        <CardHeader>
          <CardTitle>Engagement Progression by Cohort</CardTitle>
          <CardDescription>
            Average agents created by day N for each signup cohort (compare lines to see improvement)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {engagementChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={engagementChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" label={{ value: 'Days Since Signup', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Avg Agents', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                {engagementCohorts.map((cohort, i) => (
                  <Line
                    key={cohort}
                    type="monotone"
                    dataKey={cohort}
                    stroke={cohortColors[i % cohortColors.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No engagement data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time to First Action */}
      <Card>
        <CardHeader>
          <CardTitle>Time to First Action by Cohort</CardTitle>
          <CardDescription>
            Median time from signup to first agent/prompt/push (lower is better)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeToActionData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Cohort</th>
                    <th className="text-right p-2">First Agent (median)</th>
                    <th className="text-right p-2">First Prompt (median)</th>
                    <th className="text-right p-2">First Push (median)</th>
                  </tr>
                </thead>
                <tbody>
                  {timeToActionData.slice(-8).map((row) => (
                    <tr key={row.cohortLabel} className="border-b">
                      <td className="p-2 font-medium">{row.cohortLabel}</td>
                      <td className="text-right p-2">{formatHours(row.medianTimeToFirstAgent)}</td>
                      <td className="text-right p-2">{formatHours(row.medianTimeToFirstPrompt)}</td>
                      <td className="text-right p-2">{formatHours(row.medianTimeToFirstPush)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No time-to-action data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Week 2/3 Retention by Cohort */}
      <Card>
        <CardHeader>
          <CardTitle>Retention by Signup Cohort</CardTitle>
          <CardDescription>
            % of users with activity in week 2 (days 7-14) and week 3 (days 14-21) after signup
          </CardDescription>
        </CardHeader>
        <CardContent>
          {retentionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={retentionData.filter(d => d.userCount > 0).slice(-8)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="cohortLabel" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                  labelFormatter={(label) => {
                    const cohort = retentionData.find(d => d.cohortLabel === label)
                    return cohort ? `${label} (${cohort.userCount} users)` : label
                  }}
                />
                <Legend />
                <Bar dataKey="retentionRateWeek2" fill="#8884d8" name="Week 2 Retention" />
                <Bar dataKey="retentionRateWeek3" fill="#82ca9d" name="Week 3 Retention" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No retention data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Success Rate by Cohort */}
      <Card>
        <CardHeader>
          <CardTitle>Success Rate by Signup Cohort</CardTitle>
          <CardDescription>
            % of agents that achieved a pushed commit or PR (higher success = better retention)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {successData.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={successData.filter(d => d.totalAgents > 0).slice(-8)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="cohortLabel" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                  labelFormatter={(label) => {
                    const cohort = successData.find(d => d.cohortLabel === label)
                    return cohort ? `${label} (${cohort.totalAgents} agents)` : label
                  }}
                />
                <Legend />
                <Bar dataKey="pushRate" fill="#8884d8" name="Push Rate" />
                <Bar dataKey="prRate" fill="#82ca9d" name="PR Rate" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No success rate data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
