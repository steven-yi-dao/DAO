import type { Announcement } from '../hooks/useQueueAnnouncements';

interface LiveAnnouncerProps {
  announcement: Announcement;
}

// Two regions used in alternation: re-writing a region a screen reader is still
// reading can be dropped, so each message lands in the one that just went quiet.
export function LiveAnnouncer({ announcement }: LiveAnnouncerProps) {
  const first = announcement.id % 2 === 1;
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {first ? announcement.text : ''}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {first ? '' : announcement.text}
      </div>
    </>
  );
}
