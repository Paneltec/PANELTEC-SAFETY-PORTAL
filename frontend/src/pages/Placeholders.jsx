import React from "react";
import {
  Calendar, ListChecks, UserCog, ClipboardList, Clock, Users2, CalendarClock, FolderArchive
} from "lucide-react";

function Placeholder({ icon: Icon, title, description, color = "amber" }) {
  const colorMap = {
    amber: "from-amber-400 to-amber-600 text-black",
    blue: "from-blue-500 to-cyan-600 text-white",
    purple: "from-purple-500 to-pink-600 text-white",
    emerald: "from-emerald-500 to-teal-600 text-white",
    rose: "from-rose-500 to-pink-600 text-white",
    sky: "from-sky-500 to-blue-600 text-white",
    indigo: "from-indigo-500 to-purple-600 text-white",
    orange: "from-orange-500 to-red-600 text-white",
  };
  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="bg-slate-50 border-b -mx-6 -my-6 lg:-mx-8 lg:-my-8 px-6 lg:px-8 py-4 mb-6">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      </div>
      <div className="max-w-3xl mx-auto mt-12">
        <div className={`bg-gradient-to-br ${colorMap[color]} rounded-3xl p-10 shadow-xl text-center`}>
          <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Icon className="w-12 h-12"/>
          </div>
          <h2 className="text-3xl font-black mb-2">{title}</h2>
          <p className="text-lg opacity-90 max-w-xl mx-auto">{description}</p>
          <div className="mt-6 inline-block px-4 py-2 bg-white/20 rounded-full text-sm font-bold tracking-wider">
            COMING SOON · Awaiting requirements
          </div>
        </div>
        <div className="mt-6 bg-white border rounded-2xl p-5 text-sm text-slate-600">
          <div className="font-bold text-slate-900 mb-2">📝 Notes for the team</div>
          <p>This module is reserved in the navigation. The features and data structure are pending your specifications — let us know what fields, workflows, and integrations you want behind this tab and we'll build it out.</p>
        </div>
      </div>
    </div>
  );
}

export function ProjectBookingPage() {
  return <Placeholder icon={Calendar} color="blue" title="Project Booking"
    description="Book workers onto specific projects for a date range. Tie crew availability to SimPRO jobs."/>;
}

export function AllocationPage() {
  return <Placeholder icon={ListChecks} color="purple" title="Allocation"
    description="Assign workers, plant, and resources to specific tasks/jobs for a period."/>;
}

export function PersonnelRequiredPage() {
  return <Placeholder icon={UserCog} color="emerald" title="Personnel Required"
    description="Workforce planning: how many people of each skill type are required at each jobsite per day."/>;
}

export function ListPage() {
  return <Placeholder icon={ClipboardList} color="indigo" title="List"
    description="Unified searchable list view across submissions, tasks, notes, certifications and more."/>;
}

export function TimeSheetPage() {
  return <Placeholder icon={Clock} color="amber" title="Time Sheet"
    description="Individual worker time entry: clock in/out, breaks, work types (Call Out, Fatigue Break, Living Away From Home, etc.) — feeds WojoPay."/>;
}

export function GroupTimeSheetPage() {
  return <Placeholder icon={Users2} color="sky" title="Group Time Sheet"
    description="Crew-level timesheets — supervisor logs hours for the whole crew at once with bulk apply by job/cost-center."/>;
}

export function LeaveRequestsPage() {
  return <Placeholder icon={CalendarClock} color="rose" title="Leave Requests"
    description="Workers submit leave (Annual, Personal/Carer's, Compassionate, Long Service, etc.); managers approve. Syncs with WojoPay Leave Categories."/>;
}

export function FilesPage() {
  return <Placeholder icon={FolderArchive} color="orange" title="Files"
    description="Project-specific file repository (different from the global Document Library)."/>;
}
