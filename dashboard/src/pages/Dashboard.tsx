import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { HistoricalTrends } from '@/components/HistoricalTrends'
import { CohortAnalysis } from '@/components/CohortAnalysis'

interface User {
  id: string
  email: string
  name: string
  isAnonymous: boolean
  createdAt: string | null
  projectCount: number
  agentCount: number
  commitCount: number
  pushedCommitCount: number
  pushedCommitPercentage: number
}

interface DashboardStats {
  totalUsers: number
  users: User[]
  totalProjects: number
  totalAgents: number
  totalAgentCommits: number
  totalPushedCommits: number
  pushedCommitsPercentage: number
  agentsWithPushAndPR: number
  agentsWithPushAndPRPercentage: number
}

interface UserDistributionData {
  count: number
  usersByAgents: number
  usersByPrompts: number
  usersByAgentsWithPR: number
}

interface RetentionCohortData {
  dayNumber: number
  users0DayGap: number
  users1DayGap: number
  users3DayGap: number
  users7DayGap: number
}

interface SessionDurationData {
  halfHourBucket: number
  userCount: number
}

type SortKey = 'createdAt' | 'projectCount' | 'agentCount' | 'commitCount' | 'pushedCommitPercentage'
type SortDir = 'asc' | 'desc'

export function Dashboard() {
  const { token, logout } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [userDistribution, setUserDistribution] = useState<UserDistributionData[]>([])
  const [retentionCohorts, setRetentionCohorts] = useState<RetentionCohortData[]>([])
  const [sessionDuration, setSessionDuration] = useState<SessionDurationData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Sorting state for users table
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Exclude users filter (comma-separated usernames)
  const [excludeUsersInput, setExcludeUsersInput] = useState('')
  const [excludeUsersApplied, setExcludeUsersApplied] = useState('')

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'

  useEffect(() => {
    fetchStats()
  }, [token])

  useEffect(() => {
    fetchAnalytics()
  }, [token, excludeUsersApplied])

  const fetchStats = async () => {
    if (!token) {
      setError('No authentication token')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`${apiUrl}/api/admin/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Unauthorized: You do not have admin access')
        }
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        setStats(data.stats)
      } else {
        throw new Error(data.error || 'Failed to fetch stats')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchAnalytics = async () => {
    if (!token) return

    try {
      const excludeParam = excludeUsersApplied ? `?excludeUsers=${encodeURIComponent(excludeUsersApplied)}` : ''

      // Fetch all analytics in parallel
      const [distributionRes, retentionRes, sessionRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/analytics/user-distribution${excludeParam}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/api/admin/analytics/retention-cohorts${excludeParam}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/api/admin/analytics/session-duration${excludeParam}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
      ])

      if (distributionRes.ok) {
        const data = await distributionRes.json()
        if (data.success) setUserDistribution(data.data)
      }

      if (retentionRes.ok) {
        const data = await retentionRes.json()
        if (data.success) setRetentionCohorts(data.data)
      }

      if (sessionRes.ok) {
        const data = await sessionRes.json()
        if (data.success) setSessionDuration(data.data)
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    }
  }

  const handleApplyExclude = useCallback(() => {
    setExcludeUsersApplied(excludeUsersInput.trim())
  }, [excludeUsersInput])

  const handleExcludeKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleApplyExclude()
    }
  }, [handleApplyExclude])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedUsers = useMemo(() => {
    if (!stats) return []
    const users = [...stats.users]
    users.sort((a, b) => {
      let aVal: number
      let bVal: number

      if (sortKey === 'createdAt') {
        aVal = a.createdAt ? new Date(a.createdAt).getTime() : 0
        bVal = b.createdAt ? new Date(b.createdAt).getTime() : 0
      } else {
        aVal = a[sortKey]
        bVal = b[sortKey]
      }

      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })
    return users
  }, [stats, sortKey, sortDir])

  const SortIndicator = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return <span className="text-muted-foreground/40 ml-1">{'\u2195'}</span>
    return <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg">Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="text-red-500 text-center">
          <div className="text-4xl mb-4">{'\u26A0\uFE0F'}</div>
          <div className="text-xl font-semibold mb-2">Access Denied</div>
          <div>{error}</div>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg">No data available</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold mb-2">Ariana Dashboard</h1>
            <p className="text-muted-foreground">Application usage statistics</p>
          </div>
          <button
            onClick={logout}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Exclude users filter */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Filter Aggregated Stats</CardTitle>
            <CardDescription>
              Exclude usernames from on-the-fly computed stats (comma-separated GitHub usernames). Affects distribution, retention, session, and cohort charts below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <input
                type="text"
                value={excludeUsersInput}
                onChange={e => setExcludeUsersInput(e.target.value)}
                onKeyDown={handleExcludeKeyDown}
                placeholder="e.g. user1, user2, user3"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <button
                onClick={handleApplyExclude}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 transition-colors"
              >
                Apply
              </button>
              {excludeUsersApplied && (
                <button
                  onClick={() => { setExcludeUsersInput(''); setExcludeUsersApplied('') }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {excludeUsersApplied && (
              <p className="text-xs text-muted-foreground mt-2">
                Excluding: {excludeUsersApplied}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalProjects}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalAgents}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.agentsWithPushAndPR} with push & PR ({stats.agentsWithPushAndPRPercentage.toFixed(1)}%)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Agent Commits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalAgentCommits}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.totalPushedCommits} pushed ({stats.pushedCommitsPercentage.toFixed(1)}%)
              </p>
            </CardContent>
          </Card>
        </div>

        <HistoricalTrends />

        <CohortAnalysis excludeUsers={excludeUsersApplied} />

        <Card>
          <CardHeader>
            <CardTitle>User Distribution by Activity</CardTitle>
            <CardDescription>
              Number of users with at least N agents/prompts/PRs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={userDistribution.slice(0, 20)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="count" label={{ value: 'Number of Items', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Number of Users', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="usersByAgents" fill="#8884d8" name="Users with ≥N Agents" />
                <Bar dataKey="usersByPrompts" fill="#82ca9d" name="Users with ≥N Prompts" />
                <Bar dataKey="usersByAgentsWithPR" fill="#ffc658" name="Users with ≥N Agents w/ PR" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User Retention Cohorts</CardTitle>
            <CardDescription>
              Users with consistent activity from day 1 to day N (by max gap tolerance)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={retentionCohorts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dayNumber" label={{ value: 'Days Since Signup', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Number of Users', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="users0DayGap" fill="#8884d8" name="No Gap (Daily)" />
                <Bar dataKey="users1DayGap" fill="#82ca9d" name="≤1 Day Gap" />
                <Bar dataKey="users3DayGap" fill="#ffc658" name="≤3 Day Gap" />
                <Bar dataKey="users7DayGap" fill="#ff8042" name="≤7 Day Gap" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session Duration Distribution</CardTitle>
            <CardDescription>
              Number of users with at least N half-hours of total app usage
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={sessionDuration.slice(0, 40)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="halfHourBucket" label={{ value: 'Half-Hour Buckets', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Number of Users', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="userCount" fill="#8884d8" name="Users with ≥N Half-Hours" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>
              All users with per-user metrics. Click column headers to sort.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort('createdAt')}
                  >
                    Created At<SortIndicator columnKey="createdAt" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground text-right"
                    onClick={() => handleSort('projectCount')}
                  >
                    Projects<SortIndicator columnKey="projectCount" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground text-right"
                    onClick={() => handleSort('agentCount')}
                  >
                    Agents<SortIndicator columnKey="agentCount" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground text-right"
                    onClick={() => handleSort('commitCount')}
                  >
                    Commits<SortIndicator columnKey="commitCount" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground text-right"
                    onClick={() => handleSort('pushedCommitPercentage')}
                  >
                    Pushed %<SortIndicator columnKey="pushedCommitPercentage" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <span className={user.isAnonymous ? 'text-muted-foreground' : ''}>
                        {user.isAnonymous ? 'Anonymous' : 'GitHub'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString()
                        : 'N/A'}
                    </TableCell>
                    <TableCell className="text-right">{user.projectCount}</TableCell>
                    <TableCell className="text-right">{user.agentCount}</TableCell>
                    <TableCell className="text-right">
                      {user.commitCount}
                      {user.pushedCommitCount > 0 && (
                        <span className="text-muted-foreground text-xs ml-1">
                          ({user.pushedCommitCount} pushed)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.commitCount > 0
                        ? `${user.pushedCommitPercentage.toFixed(1)}%`
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
