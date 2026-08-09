function Bar({ className = '', ...rest }) {
  return <div className={`animate-pulse rounded-lg bg-black/5 dark:bg-white/10 ${className}`} {...rest} />;
}

export default function ChatSkeleton() {
  return (
    <div data-testid="chat-skeleton" className="flex flex-1 gap-4">
      <div className="hidden w-full max-w-[340px] flex-col gap-2 rounded-2xl border border-black/5 bg-white/70 p-3 dark:border-white/5 dark:bg-surface-dark-card lg:flex">
        <Bar className="h-8" />
        <Bar className="h-8" />
        {Array.from({ length: 6 }, (_, index) => (
          <Bar key={index} data-testid="conversation-skeleton-row" className="h-16" />
        ))}
      </div>

      <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/5 dark:bg-surface-dark-card">
        <Bar className="h-10 w-2/3" />
        <div className="flex flex-1 flex-col justify-end gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Bar key={index} data-testid="message-skeleton-row" className={`h-10 ${index % 2 === 0 ? 'w-1/2 self-start' : 'w-1/3 self-end'}`} />
          ))}
        </div>
        <Bar className="h-10" />
      </div>
    </div>
  );
}
