import { cx } from '@/lib/cx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ padded = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'rounded-card border border-gray-200 bg-white shadow-card',
        padded && 'p-5 sm:p-6',
        className,
      )}
      {...rest}
    />
  );
}
