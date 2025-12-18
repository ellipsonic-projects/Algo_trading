import DashboardPage from '../DashboardPage/DashboardPage'
import StrategiesLayout from './StrategiesLayout'

export default function ManualTradingPage() {
  return (
    <StrategiesLayout title="Manual Trading" subtitle="Equity orders, index options, and order history." backTo="/strategies">
      <DashboardPage hideHeader />
    </StrategiesLayout>
  )
}
