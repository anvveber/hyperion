import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Navigation from '@/components/Navigation';
import CalendarView from '@/components/calendar/CalendarView';
import { getCalendarEvents } from '@/lib/calendar/load';

export default async function CalendarPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const events = await getCalendarEvents(session.user.id);

  return (
    <div className="min-h-screen bg-background">
      <Navigation
        userEmail={session.user.email || undefined}
        userName={session.user.name}
        userNickname={session.user.nickname}
        userPhoto={session.user.photo}
        currentPath="/calendar"
      />

      <main className="max-w-5xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <CalendarView events={events} />
        </div>
      </main>
    </div>
  );
}
