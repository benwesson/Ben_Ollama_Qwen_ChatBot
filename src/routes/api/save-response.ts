import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/save-response')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/api/save-response"!</div>
}
