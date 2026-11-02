'use client';
import ExpensesPage from './ExpensesPage';

/** Common internal employee page; eligibility and review scope are resolved by the API. */
export default function DepartmentExpensesPage({ appearance }) {
  return <ExpensesPage ownMode appearance={appearance} />;
}
