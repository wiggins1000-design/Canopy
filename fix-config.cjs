const fs = require('fs');
let src = fs.readFileSync('src/pages/ConfigPage.jsx', 'utf8');

const newFn = `function SubscriptionSection() {
  const { isTrialing, isActive, isPastDue, daysLeft, periodEnd, trialEndsAt } = useSubscription()

  const statusLabel = isActive
    ? { text: 'Active', cls: 'bg-green-100 text-green-700' }
    : isTrialing
    ? { text: \`Trial — \${daysLeft} day\${daysLeft !== 1 ? 's' : ''} left\`, cls: 'bg-amber-100 text-amber-700' }
    : isPastDue
    ? { text: 'Payment overdue', cls: 'bg-red-100 text-red-700' }
    : { text: 'Cancelled', cls: 'bg-gray-100 text-gray-600' }

  return (
    <AccordionGroup label="Subscription">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700">Family plan · £12.99/month</span>
          <span className={\`text-xs font-semibold px-2.5 py-1 rounded-full \${statusLabel.cls}\`}>
            {statusLabel.text}
          </span>
        </div>

        {isActive && periodEnd && (
          <p className="text-xs text-gray-400">
            Next billing: {periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
        {isTrialing && trialEndsAt && (
          <p className="text-xs text-gray-400">
            Trial ends: {trialEndsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}

        <p className="text-xs text-gray-400">Managed via the App Store or Google Play. Both parents included.</p>
      </div>
    </AccordionGroup>
  )
}`;

// Match from function start to closing brace before ExpenseSplitRow
const match = src.match(/function SubscriptionSection\(\)[\s\S]+?\n\}\n(?=\nfunction ExpenseSplitRow)/);
if (!match) {
  console.error('Pattern not found');
  process.exit(1);
}

src = src.replace(match[0], newFn + '\n');
fs.writeFileSync('src/pages/ConfigPage.jsx', src, 'utf8');
console.log('Done');
