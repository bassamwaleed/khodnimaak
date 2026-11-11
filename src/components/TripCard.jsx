import React, { useState, useEffect } from 'react';
import { doc, deleteDoc, getDoc } from 'firebase/firestore';
import {
  Trash2, Share2, ShieldCheck, Star, Clock, Car, Package, CheckCircle2,
  Phone, MessageCircle, Route, Handshake, Users, Flame, Lock, ArrowLeft
} from 'lucide-react';
import { db, APP_COLLECTION_NAME, USERS_COLLECTION } from '../firebase';
import { formatTripDateTime, getSeatsText } from '../utils/helpers';

const PREFERENCE_LABELS = {
  ac: 'تكييف ❄️',
  noSmoking: 'منع التدخين',
  luggage: 'شنط',
  families: 'عائلات'
};

const TripCard = ({
  trip, user, isAdmin, isDarkMode, openChatFromTrip, triggerToast,
  matchBadge, onOpenPublicProfile, compact = false
}) => {
  const isOwner = user?.uid === trip?.userId;
  const isCompleted = trip?.status === 'completed';
  const isFull = trip?.status === 'full';
  const isFemalesOnly = Boolean(trip?.preferences?.femalesOnly);
  const isRequest = trip?.type === 'request';
  const joinedMembers = Array.isArray(trip?.joinedMembers) ? trip.joinedMembers : [];

  const [contactPhone, setContactPhone] = useState(trip?.userPhone || '');
  const [liveVerified, setLiveVerified] = useState(Boolean(trip?.verified));
  const [liveBadge, setLiveBadge] = useState(trip?.userBadge || null);
  const [liveRating, setLiveRating] = useState(Number(trip?.rating || 0));
  const [liveReviewsCount, setLiveReviewsCount] = useState(0);
  const [liveCarModel, setLiveCarModel] = useState(trip?.carModel || '');
  const [liveCarColor, setLiveCarColor] = useState(trip?.carColor || '');

  useEffect(() => {
    setLiveVerified(Boolean(trip?.verified));
    setLiveBadge(trip?.userBadge || null);
  }, [trip?.verified, trip?.userBadge]);

  useEffect(() => {
    if (!trip?.userId) return;
    let isMounted = true;
    getDoc(doc(db, USERS_COLLECTION, trip.userId))
      .then((snap) => {
        if (isMounted && snap.exists()) {
          const uData = snap.data();
          if (!trip?.userPhone && trip?.allowPhoneContact !== false && uData?.phone) {
            setContactPhone(uData.phone);
          }
          if (typeof uData?.isVerified === 'boolean') setLiveVerified(uData.isVerified);
          if (uData?.customBadge !== undefined) setLiveBadge(uData.customBadge);
          if (uData?.rating !== undefined) setLiveRating(Number(uData.rating));
          if (Array.isArray(uData?.reviews)) setLiveReviewsCount(uData.reviews.length);
          else if (uData?.ratingsCount) setLiveReviewsCount(Number(uData.ratingsCount));
          if (!trip?.carModel && uData?.carModel) {
            setLiveCarModel(uData.carModel);
            setLiveCarColor(uData.carColor || '');
          }
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [trip?.userPhone, trip?.userId, trip?.allowPhoneContact, trip?.carModel]);

  if (!trip) return null;

  const contactMethod = trip?.contactMethod || (trip?.allowPhoneContact === false ? 'chat' : 'both');
  const hasValidPhone = Boolean(contactPhone && String(contactPhone).trim());
  const canCall = hasValidPhone && (contactMethod === 'both' || contactMethod === 'phone');
  const canWhatsapp = hasValidPhone && (contactMethod === 'both' || contactMethod === 'whatsapp');

  const getWhatsAppUrl = (rawPhone) => {
    const clean = String(rawPhone).replace(/\D/g, '');
    const intlPhone = clean.startsWith('20') ? clean : clean.startsWith('0') ? `2${clean}` : `20${clean}`;
    const msg = `مرحباً ${trip?.userName?.split(' ')[0] || 'كابتن'}، تواصلت معك عبر تطبيق (طريقنا) بخصوص رحلة: ${trip?.from} ➔ ${trip?.to}`;
    return `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;
  };

  const getRemainingTimeBadge = () => {
    if (!trip?.date || !trip?.time || isCompleted) return null;
    try {
      const tripTime = new Date(`${trip.date}T${trip.time}`).getTime();
      const diffHours = (tripTime - Date.now()) / (1000 * 3600);
      if (diffHours > 0 && diffHours < 1) return { text: `خلال ${Math.max(5, Math.round(diffHours * 60))} د`, urgent: true };
      if (diffHours >= 1 && diffHours <= 6) return { text: `باقي ${Math.round(diffHours)} س`, urgent: false };
      return null;
    } catch (e) {
      return null;
    }
  };
  const countdown = getRemainingTimeBadge();

  const price = trip.cost || trip.price || trip.fare || null;

  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, APP_COLLECTION_NAME, trip.id));
      triggerToast('تم الحذف بنجاح');
    } catch (err) {
      triggerToast('حدث خطأ أثناء الحذف');
    }
  };

  const handleShare = (e) => {
    e.stopPropagation();
    const routeStr = Array.isArray(trip?.routeAreas) && trip.routeAreas.length > 0 ? `\n🛣️ يمر بـ: ${trip.routeAreas.join(' - ')}` : '';
    const carStr = liveCarModel ? `\n🚘 السيارة: ${liveCarModel} ${liveCarColor ? `(${liveCarColor})` : ''}` : '';
    const text = `🚗 رحلة على تطبيق (طريقنا)${isFemalesOnly ? ' (بنات فقط 👩)' : ''}\n📍 من: ${trip.from}\n🏁 إلى: ${trip.to}${routeStr}${carStr}\n⏰ الموعد: ${formatTripDateTime(trip.date, trip.time)}\n💺 التكلفة: ${price ? price + ' ج' : 'غير محدد'}`;
    if (navigator.share) {
      navigator.share({ title: 'طريقنا', text }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`);
    }
  };

  const activePreferences = trip.preferences
    ? Object.keys(trip.preferences).filter((k) => trip.preferences[k] && k !== 'femalesOnly' && PREFERENCE_LABELS[k])
    : [];
  const routeAreas = Array.isArray(trip?.routeAreas) ? trip.routeAreas : [];

  const accentText = isFemalesOnly ? 'text-pink-500' : 'text-indigo-500';
  const accentSolid = isFemalesOnly ? 'bg-pink-600 hover:bg-pink-700' : 'bg-indigo-600 hover:bg-indigo-700';
  const stripe = (isCompleted || isFull)
    ? 'border-r-slate-300 dark:border-r-slate-700'
    : isFemalesOnly ? 'border-r-pink-500' : 'border-r-indigo-500';

  const surface = isDarkMode
    ? (isFemalesOnly ? 'bg-pink-950/20 border-slate-800' : 'bg-slate-900 border-slate-800')
    : (isFemalesOnly ? 'bg-pink-50/50 border-slate-200' : 'bg-white border-slate-200');
  const textPrimary = isDarkMode ? 'text-white' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const chip = isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700';
  const iconBtn = isDarkMode
    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200';

  const canOpen = !isOwner && !isCompleted && !isFull;
  const openChat = () => canOpen && openChatFromTrip(trip);

  return (
    <article
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={openChat}
      onKeyDown={(e) => { if (canOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openChat(); } }}
      className={`relative flex flex-col p-3 gap-2 rounded-2xl border border-r-4 ${stripe} ${surface} shadow-sm transition-shadow hover:shadow-md ${canOpen ? 'cursor-pointer' : ''} ${(isCompleted || isFull) ? 'opacity-70' : ''}`}
    >
      {/* 1) صف الهيدر المدمج: الكابتن + السعر */}
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (onOpenPublicProfile && trip?.userId) onOpenPublicProfile(trip.userId); }}
          aria-label="عرض البروفايل"
          className="flex items-center gap-2 min-w-0 text-right"
        >
          <span className="relative shrink-0">
            {trip?.userPhoto ? (
              <img src={trip.userPhoto} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${isFemalesOnly ? 'bg-pink-100 text-pink-700' : 'bg-indigo-100 text-indigo-700'}`}>
                {(trip?.userName || 'م').charAt(0)}
              </span>
            )}
            {liveVerified && (
              <span className="absolute -bottom-0.5 -left-0.5 bg-emerald-500 text-white p-0.5 rounded-full ring-2 ring-white dark:ring-slate-900">
                <ShieldCheck size={9} />
              </span>
            )}
          </span>

          <span className="min-w-0">
            <span className="flex items-center gap-1 flex-wrap">
              <span className={`text-xs font-black truncate max-w-[125px] ${textPrimary}`}>
                {trip?.userName?.split(' ').slice(0, 2).join(' ') || 'مستخدم'}
              </span>
              <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${textSecondary}`}>
                <Star size={10} className="fill-amber-400 text-amber-400" />
                {liveRating > 0 ? liveRating.toFixed(1) : 'جديد'}
              </span>
              {liveBadge && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 dark:text-amber-400 shrink-0">
                  {liveBadge}
                </span>
              )}
            </span>
          </span>
        </button>

        <div className="flex items-baseline gap-1 shrink-0 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-xl">
          {price ? (
            <>
              <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{price}</span>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">ج</span>
              <span className={`text-xs ${textSecondary}`}>/{trip?.category === 'parcel' ? 'طرد' : 'فرد'}</span>
            </>
          ) : (
            <span className={`text-xs font-bold ${textSecondary}`}>غير محدد</span>
          )}
        </div>
      </header>

      {/* 2) المسار الأفقي المدمج (من ⬅️ إلى في سطر واحد) */}
      <div className={`px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 ${isDarkMode ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200/70'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full border-2 shrink-0 ${isFemalesOnly ? 'border-pink-500' : 'border-indigo-500'}`} />
            <p className={`text-sm font-black truncate ${textPrimary}`}>{trip?.from || 'غير محدد'}</p>
          </div>
          {trip?.fromDetails && <p className={`text-xs truncate pr-3.5 ${textSecondary}`}>{trip.fromDetails}</p>}
        </div>

        <div className="flex flex-col items-center shrink-0 px-1">
          <ArrowLeft size={15} className={accentText} />
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-end gap-1.5">
            <p className={`text-sm font-black truncate ${textPrimary}`}>{trip?.to || 'غير محدد'}</p>
            <span className={`w-2 h-2 rounded-full shrink-0 ${isFemalesOnly ? 'bg-pink-500' : 'bg-indigo-500'}`} />
          </div>
          {trip?.toDetails && <p className={`text-xs truncate pl-3.5 ${textSecondary}`}>{trip.toDetails}</p>}
        </div>
      </div>

      {/* 3) الموعد والمقاعد والشارات في سطر واحد متناسق */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-xs font-bold ${textPrimary}`}>
            <Clock size={12} className={accentText} />
            {formatTripDateTime(trip?.date, trip?.time)}
          </span>

          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg ${isFull ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : isRequest ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : chip}`}>
            {trip?.category === 'parcel' ? <Package size={11} /> : <Car size={11} />}
            {isFull ? 'مكتمل' : getSeatsText(trip?.seats, trip?.category)}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {countdown && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-black px-2 py-0.5 rounded-full ${countdown.urgent ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
              {countdown.urgent && <Flame size={11} />} {countdown.text}
            </span>
          )}
          {isFemalesOnly && (
            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-pink-600 text-white">بنات فقط</span>
          )}
          {matchBadge && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${/قريباً/.test(matchBadge) ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'}`}>
              {matchBadge}
            </span>
          )}
        </div>
      </div>

      {/* 4) خط السير والسيارة والتفضيلات (شريط أفقي مضغوط بدون زحمة) */}
      {(routeAreas.length > 0 || liveCarModel || activePreferences.length > 0) && (
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden">
          {routeAreas.length > 0 && (
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${chip}`}>
              <Route size={11} className="text-indigo-500" /> يمر بـ: {routeAreas.slice(0, 3).join(' • ')}{routeAreas.length > 3 ? ` +${routeAreas.length - 3}` : ''}
            </span>
          )}
          {liveCarModel && (
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${chip}`}>
              <Car size={11} /> {liveCarModel}{liveCarColor ? ` (${liveCarColor})` : ''}
            </span>
          )}
          {activePreferences.map((key) => (
            <span key={key} className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${chip}`}>
              {PREFERENCE_LABELS[key]}
            </span>
          ))}
        </div>
      )}

      {joinedMembers.length > 0 && (
        <p className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 truncate">
          <Users size={12} className="shrink-0" />
          <span>انضم: {joinedMembers.map((m) => `${m.name?.split(' ')[0] || 'راكب'}${m.seats > 1 ? ` (${m.seats})` : ''}`).join('، ')}</span>
        </p>
      )}

      {trip?.notes && (
        <p className={`text-xs truncate ${textSecondary}`} title={trip.notes}>
          💬 {trip.notes}
        </p>
      )}

      {/* 5) أزرار التواصل المدمجة */}
      <footer className="flex items-center justify-between gap-1.5 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
        {isOwner ? (
          <div className="flex items-center justify-between w-full">
            <span className={`text-xs font-bold ${textSecondary}`}>
              إعلانك {joinedMembers.length > 0 ? `• ${joinedMembers.length} حجز` : ''}
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={handleShare} aria-label="مشاركة" className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBtn}`}>
                <Share2 size={15} />
              </button>
              <button type="button" onClick={handleDelete} aria-label="حذف" className="w-9 h-9 rounded-xl flex items-center justify-center bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white transition-colors">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ) : isCompleted ? (
          <div className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={14} /> رحلة مكتملة
          </div>
        ) : isFull ? (
          <div className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-black bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Lock size={14} /> اكتمل العدد
          </div>
        ) : (
          <div className="flex items-center gap-1.5 w-full">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openChatFromTrip(trip); }}
              className={`flex-1 h-9 rounded-xl text-xs font-black text-white shadow-sm active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5 ${accentSolid}`}
            >
              <MessageCircle size={15} /> تواصل
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openChatFromTrip({ ...trip, openNegotiation: true }); }}
              aria-label="تفاوض على السعر أو المقاعد"
              title="تفاوض"
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBtn}`}
            >
              <Handshake size={15} />
            </button>

            {canCall && (
              <a
                href={`tel:${contactPhone}`}
                onClick={(e) => e.stopPropagation()}
                aria-label="اتصال هاتفي"
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBtn}`}
              >
                <Phone size={15} />
              </a>
            )}

            {canWhatsapp && (
              <a
                href={getWhatsAppUrl(contactPhone)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="واتساب"
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <MessageCircle size={15} />
              </a>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={handleDelete}
                aria-label="حذف أدمن"
                title="حذف (أدمن)"
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-rose-500/10 text-rose-600 hover:bg-rose-600 hover:text-white"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </footer>
    </article>
  );
};

export default TripCard;
