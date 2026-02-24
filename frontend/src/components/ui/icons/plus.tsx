export default function Plus({ className }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#000000" fill="none">
            <path className="opacity-30 dark:opacity-20" d="M12 2.75C12.6904 2.75 13.25 3.30964 13.25 4V20C13.25 20.6904 12.6904 21.25 12 21.25C11.3096 21.25 10.75 20.6904 10.75 20V4C10.75 3.30964 11.3096 2.75 12 2.75Z" fill="currentColor"></path>
            <path className="dark:opacity-40 opacity-60" opacity="0.4" d="M4 10.75H20C20.6904 10.75 21.25 11.3096 21.25 12C21.25 12.6904 20.6904 13.25 20 13.25H4C3.30964 13.25 2.75 12.6904 2.75 12C2.75 11.3096 3.30964 10.75 4 10.75Z" fill="currentColor"></path>
        </svg>
    );
}
