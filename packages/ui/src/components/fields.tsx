"use client";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { NumberField } from "@base-ui/react/number-field";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { DayPicker } from "react-day-picker";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { cn } from "../lib/utils";
import { buttonClass } from "../classes";
import { bareInputClass, controlBoxClass, controlClass } from "../control";
import { useIsPhone } from "../media";
import { Sheet } from "./sheet";
import { Checkbox } from "./ui/checkbox";
import { PopoverContent } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import {
  formatLocalDateTime,
  joinLocalDateTime,
  splitLocalDateTime,
} from "../datetime";

interface ControlProps {
  /** The control's id; the surrounding Field's label points at it. */
  id: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

const caretClass =
  "ml-auto inline-flex flex-none text-muted-foreground transition-transform duration-150 ease-standard in-data-popup-open:rotate-180";

/**
 * A date and time on the session's own wall clock, stored as the same
 * "YYYY-MM-DDTHH:mm" string a datetime-local input produces. The trigger reads
 * like a sentence. On larger screens a popover pairs a month calendar with
 * 15-minute slots; on a phone the same panel opens as a bottom sheet, where
 * there is room for it above the keyboard-free half of the screen.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  disabled,
  title = "Choose date and time",
  placeholder = "Pick a date and time",
  defaultTime = "18:00",
  allowPast = false,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  /** The sheet heading on phones; use the field's label. */
  title?: string;
  placeholder?: string;
  /** Used when a date is picked before any time. */
  defaultTime?: string;
  /** Days before today can't be picked unless this is set. */
  allowPast?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const phone = useIsPhone();
  const button = useRef<HTMLButtonElement>(null);
  // Safari doesn't focus a tapped button, so the dialog can't hand focus back
  // on its own; return it to the trigger explicitly.
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const label = formatLocalDateTime(value);
  const trigger = {
    id,
    className: cn(controlClass, "cursor-pointer"),
    disabled,
    // The field's label plus the chosen value, so "Starts, Thu, Nov 5 ·
    // 7:00 PM" is announced rather than the label alone.
    "aria-labelledby": `${id}-label ${id}-value`,
    "aria-describedby": describedBy,
    children: (
      <>
        <CalendarBlankIcon
          className="flex-none text-muted-foreground"
          size={20}
          aria-hidden="true"
        />
        <span
          id={`${id}-value`}
          className={cn(
            "min-w-0 flex-1 truncate",
            label ? "tabular-nums" : "text-muted-foreground",
          )}
        >
          {label ?? placeholder}
        </span>
        <CaretDownIcon className={caretClass} size={16} aria-hidden="true" />
      </>
    ),
  };
  const done = buttonClass({ variant: "primary", size: "sm" });
  const panel = (doneButton: ReactNode) => (
    <DateTimePanel
      id={id}
      value={value}
      onChange={onChange}
      defaultTime={defaultTime}
      allowPast={allowPast}
      done={doneButton}
      inSheet={phone}
    />
  );
  if (phone)
    return (
      <>
        <button
          ref={button}
          type="button"
          aria-haspopup="dialog"
          data-popup-open={open || undefined}
          onClick={() => setOpen(true)}
          {...trigger}
        />
        <Sheet open={open} onClose={close} title={title}>
          {panel(
            <button type="button" className={done} onClick={close}>
              Done
            </button>,
          )}
        </Sheet>
      </>
    );
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger {...trigger} />
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-auto max-w-[calc(100vw-24px)]"
      >
        <PopoverPrimitive.Title className="sr-only">
          {title}
        </PopoverPrimitive.Title>
        {panel(
          <PopoverPrimitive.Close className={done}>
            Done
          </PopoverPrimitive.Close>,
        )}
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

// The calendar's look, by react-day-picker part. Day cells carry data-today,
// data-selected, data-outside and data-disabled, which style their button.
const navButton =
  "inline-flex size-control-sm items-center justify-center rounded-full border-0 bg-transparent p-0 text-foreground hover:bg-muted disabled:text-muted-foreground disabled:opacity-50";
const calendarClasses = {
  root: "relative flex-none",
  month_caption: "flex h-control-sm items-center pl-2 font-semibold",
  nav: "absolute top-0 right-0 z-1 flex gap-1",
  button_previous: navButton,
  button_next: navButton,
  month_grid: "mt-1 border-collapse",
  weekday: "h-control-sm w-day text-xs font-semibold text-muted-foreground",
  day: "group/day py-0.5 text-center",
  day_button:
    "size-day rounded-full border-0 bg-transparent p-0 text-sm text-foreground tabular-nums transition-colors duration-150 ease-standard hover:bg-muted group-data-today/day:font-bold group-data-today/day:shadow-ring-chrome group-data-selected/day:bg-primary group-data-selected/day:font-bold group-data-selected/day:text-primary-foreground group-data-selected/day:shadow-none group-data-outside/day:text-muted-foreground group-data-outside/day:opacity-55 group-data-disabled/day:cursor-not-allowed group-data-disabled/day:opacity-35",
  hidden: "invisible",
};

function DateTimePanel({
  id,
  value,
  onChange,
  defaultTime,
  allowPast,
  done,
  inSheet,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  defaultTime: string;
  allowPast: boolean;
  done: ReactNode;
  inSheet: boolean;
}) {
  const { date, time } = splitLocalDateTime(value);
  // Today, from its first moment: earlier days are greyed out and can't be picked.
  const [today] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  return (
    <>
      <div
        className={cn("flex gap-3 max-md:flex-col", inSheet && "items-center")}
      >
        <DayPicker
          classNames={calendarClasses}
          mode="single"
          selected={date ?? undefined}
          defaultMonth={date ?? undefined}
          showOutsideDays
          disabled={allowPast ? undefined : { before: today }}
          onSelect={(day) => {
            if (day) onChange(joinLocalDateTime(day, time ?? defaultTime));
          }}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? (
                <CaretLeftIcon size={18} aria-hidden="true" />
              ) : (
                <CaretRightIcon size={18} aria-hidden="true" />
              ),
          }}
        />
        <TimeInput
          id={`${id}-time`}
          value={time}
          disabled={!date}
          onPick={(next) => date && onChange(joinLocalDateTime(date, next))}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        {value ? (
          <button
            type="button"
            className={cn(buttonClass({ variant: "link" }), "min-h-control-sm")}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        ) : (
          <span />
        )}
        {done}
      </div>
    </>
  );
}

/**
 * The time, as shadcn's date-and-time picker does it: a plain time input
 * beside the calendar, typed or chosen with the device's own wheel.
 */
function TimeInput({
  id,
  value,
  disabled,
  onPick,
}: {
  id: string;
  value: string | null;
  disabled: boolean;
  onPick: (time: string) => void;
}) {
  return (
    <div className="grid content-start gap-2 max-md:w-full">
      <label htmlFor={id} className="text-sm font-semibold">
        Time
      </label>
      <Input
        id={id}
        type="time"
        step={60}
        value={value ?? ""}
        disabled={disabled}
        aria-describedby={disabled ? `${id}-hint` : undefined}
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
        className="w-36 appearance-none bg-background tabular-nums max-md:w-full [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
      {disabled ? (
        <p id={`${id}-hint`} className="m-0 text-xs text-muted-foreground">
          Pick a date first.
        </p>
      ) : null}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** Choices under a heading, e.g. areas under their region. */
export interface OptionGroup {
  label: string;
  options: Option[];
}

/**
 * A list of fixed choices, styled like the other controls (shadcn Select).
 * Pass `groups` instead of `options` to show the choices under headings.
 */
export function SelectField({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
} & (
    | { options: Option[]; groups?: never }
    | { groups: OptionGroup[]; options?: never }
  )) {
  const items = options ?? groups.flatMap((group) => group.options);
  const item = (option: Option) => (
    <SelectItem key={option.value} value={option.value}>
      {option.label}
    </SelectItem>
  );
  return (
    <Select
      items={items}
      // With a placeholder, an empty value means nothing chosen yet; without
      // one, "" is a real choice (e.g. "No rating").
      value={placeholder && !value ? null : value}
      onValueChange={(next) => next !== null && onChange(String(next))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-describedby={describedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent sideOffset={8} alignItemWithTrigger={false}>
        {options
          ? options.map(item)
          : groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.options.map(item)}
              </SelectGroup>
            ))}
      </SelectContent>
    </Select>
  );
}

const stepButton =
  "inline-flex size-control-sm flex-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground not-disabled:hover:bg-muted not-disabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A whole number with − and + buttons. The form keeps text, so the value goes
 * in and out as a string; an empty field stays empty rather than becoming 0.
 */
export function NumberStepper({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
}) {
  const parsed = value.trim() === "" ? null : Number(value);
  return (
    <NumberField.Root
      id={id}
      value={Number.isFinite(parsed) ? parsed : null}
      onValueChange={(next) => onChange(next === null ? "" : String(next))}
      min={min}
      max={max}
      step={1}
      disabled={disabled}
    >
      <NumberField.Group className={cn(controlClass, controlBoxClass, "px-1")}>
        <NumberField.Decrement className={stepButton} aria-label="Decrease">
          <MinusIcon size={18} aria-hidden="true" />
        </NumberField.Decrement>
        <NumberField.Input
          className={cn(
            bareInputClass,
            "text-center font-semibold tabular-nums",
          )}
          aria-describedby={describedBy}
        />
        <NumberField.Increment className={stepButton} aria-label="Increase">
          <PlusIcon size={18} aria-hidden="true" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

/** A text input with a fixed prefix (a currency code) inside the same box. */
export function AffixInput({
  prefix,
  className,
  ...props
}: { prefix: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn(controlClass, controlBoxClass)}>
      <span
        className="flex-none border-r border-border pr-3 text-sm font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {prefix}
      </span>
      <input className={cn(bareInputClass, className)} {...props} />
    </div>
  );
}

/** An on/off setting with its label and an optional line of detail. */
export function SwitchField({
  checked,
  onCheckedChange,
  disabled,
  children,
  description,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="mt-4 mb-1 flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3">
      <span className="grid gap-0.5">
        <span className="font-semibold">{children}</span>
        {description ? (
          <span className="text-sm font-normal text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </label>
  );
}

/** A checkbox with its label beside it; the whole row is the target. */
export function CheckField({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="mt-4 mb-1 flex cursor-pointer items-start gap-3 font-medium">
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}
